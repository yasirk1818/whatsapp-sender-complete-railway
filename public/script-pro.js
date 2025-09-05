// WhatsApp Sender Pro - Multi-Device & Bulk Messaging
class WhatsAppSenderPro {
    constructor() {
        this.socket = null;
        this.userId = this.generateUserId();
        this.devices = new Map();
        this.selectedDeviceId = null;
        // Bulk SMS properties
        this.selectedDevices = new Set();
        this.recipients = [];
        this.manualRecipients = [];
        this.csvRecipients = [];
        this.currentInputMethod = 'manual'; // 'manual' or 'csv'
        this.campaign = {
            isActive: false,
            name: '',
            total: 0,
            sent: 0,
            failed: 0,
            currentIndex: 0,
            deviceRotation: {
                strategy: 'round-robin',
                currentDeviceIndex: 0,
                deviceUsageCount: new Map(),
                messagesPerDevice: 10,
                currentDeviceMessageCount: 0,
                currentDevice: null
            }
        };
        this.rotationStats = {
            strategy: 'round-robin',
            totalMessagesSent: 0,
            activeCampaigns: 0,
            deviceUsage: new Map()
        };
        this.delaySettings = {
            selectedOption: '2000',
            customMinDelay: 5,
            customMaxDelay: 20
        };
        this.rotationSettings = {
            strategy: 'round-robin',
            messagesPerDevice: 10,
            selectedDevices: []
        };
        this.init();
    }

    generateUserId() {
        // Use localStorage for user ID
        let id = localStorage.getItem('whatsapp_user_id');
        if (!id) {
            id = `user_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            localStorage.setItem('whatsapp_user_id', id);
        }
        return id;
    }

    init() {
        // Initialize socket connection directly
        this.initSocket();
        this.setupEventListeners();
        this.updateUserDisplay();
        this.loadRotationStats();
        this.loadDelaySettings();
        this.loadRotationSettings();
        this.updateRotationDisplay();
    }



    initSocket() {
        // Prevent multiple socket connections
        if (window.socketConnectionActive) {
            console.log('Socket connection already active, skipping initialization');
            return;
        }
        
        window.socketConnectionActive = true;
        this.socket = io();
        
        // Register this socket for global cleanup
        window.socketManager = this;
        
        this.socket.on('connect', () => {
            this.updateConnectionStatus('connected');
            this.socket.emit('identify-user', { userId: this.userId });
        });
        
        this.socket.on('disconnect', () => {
            this.updateConnectionStatus('disconnected');
            window.socketConnectionActive = false; // Reset flag on disconnect
        });
        
        this.socket.on('user-devices', (data) => this.updateDevicesList(data.devices));
        this.socket.on('device-created', () => { this.showToast('Success', 'Device created!'); this.refreshDevices(); });
        this.socket.on('device-qr-code', (data) => {
            this.showToast('Success', `QR code ready for device! Scan to connect.`, 'success');
            this.showQR(data.qrCode, data.deviceId);
        });
        this.socket.on('device-ready', () => { this.showToast('Success', 'Device connected!'); this.refreshDevices(); });
        this.socket.on('message-sent', () => this.showToast('Success', 'Message sent!'));
        this.socket.on('error', (data) => this.showToast('Error', data.message));
        
        // Bulk messaging and rotation statistics events
        this.socket.on('bulk-message-progress', (data) => this.updateRotationStats(data));
        this.socket.on('bulk-message-sent', (data) => this.incrementMessageCount(data));
        this.socket.on('bulk-message-complete', (data) => this.updateCampaignComplete(data));
        this.socket.on('rotation-strategy-updated', (data) => this.updateRotationStrategy(data));
        
        // Persistent campaign events
        this.socket.on('bulk-message-progress', (data) => {
            console.log('Bulk message progress:', data); // Debug log
            if (data.campaignId === this.campaign.id) {
                // Update campaign progress from server
                this.campaign.sent = data.sent || 0;
                this.campaign.failed = data.failed || 0;
                this.updateCampaignProgress();
                
                // Update current recipient display
                const currentRecipientEl = document.getElementById('current-recipient');
                const currentDeviceEl = document.getElementById('current-device');
                const typingStatusEl = document.getElementById('typing-status');
                const sendingStatusEl = document.getElementById('sending-status');
                
                if (currentRecipientEl) currentRecipientEl.textContent = data.recipient || '-';
                if (currentDeviceEl) currentDeviceEl.textContent = data.deviceName || '-';
                
                // Show typing status if typing simulation is enabled
                if (data.enableTypingSimulation !== false && document.getElementById('typing-simulation')?.checked) {
                    console.log('Showing typing status for:', data.recipient); // Debug log
                    if (typingStatusEl) {
                        typingStatusEl.style.display = 'inline';
                        sendingStatusEl.style.display = 'none';
                    }
                    
                    // Calculate realistic delay based on message length (matches backend logic)
                    const message = document.getElementById('message-template')?.value || '';
                    const baseTypingSpeed = 300; // ms per character (matches backend)
                    const variabilityFactor = 0.5 + Math.random(); // 0.5x to 1.5x speed
                    const messageLength = message.length;
                    const baseDuration = messageLength * baseTypingSpeed * variabilityFactor;
                    const typingDuration = Math.min(Math.max(baseDuration, 1000), 15000); // Min 1s, max 15s
                    
                    // Add random pause (matches backend)
                    const isLongPause = Math.random() < 0.2; // 20% chance
                    const randomPause = isLongPause ? (Math.random() * 6000 + 2000) : (Math.random() * 2500 + 500);
                    const totalDelay = typingDuration + randomPause;
                    
                    console.log(`Typing simulation: ${typingDuration}ms + ${randomPause}ms = ${totalDelay}ms`); // Debug log
                    
                    // After realistic delay, show sending status
                    setTimeout(() => {
                        if (typingStatusEl) typingStatusEl.style.display = 'none';
                        if (sendingStatusEl) sendingStatusEl.style.display = 'inline';
                    }, Math.min(totalDelay, 5000)); // Cap UI delay at 5 seconds for better UX
                } else {
                    console.log('Typing simulation disabled, showing sending status directly'); // Debug log
                    // Hide typing status, show sending directly
                    if (typingStatusEl) typingStatusEl.style.display = 'none';
                    if (sendingStatusEl) sendingStatusEl.style.display = 'inline';
                }
            }
        });
        
        this.socket.on('bulk-message-sent', (data) => {
            if (data.campaignId === this.campaign.id) {
                this.incrementMessageCount({ deviceId: data.deviceId });
                this.showToast('Info', `Message sent to ${data.recipient.name || data.recipient.phoneNumber} via ${data.deviceName}`, 'success');
                
                // Clear status indicators
                const typingStatusEl = document.getElementById('typing-status');
                const sendingStatusEl = document.getElementById('sending-status');
                if (typingStatusEl) typingStatusEl.style.display = 'none';
                if (sendingStatusEl) sendingStatusEl.style.display = 'none';
            }
        });
        
        this.socket.on('bulk-message-error', (data) => {
            if (data.campaignId === this.campaign.id) {
                this.showToast('Warning', `Failed to send to ${data.recipient.name || data.recipient.phoneNumber}: ${data.error}`, 'warning');
                
                // Clear status indicators
                const typingStatusEl = document.getElementById('typing-status');
                const sendingStatusEl = document.getElementById('sending-status');
                if (typingStatusEl) typingStatusEl.style.display = 'none';
                if (sendingStatusEl) sendingStatusEl.style.display = 'none';
            }
        });
        
        this.socket.on('bulk-message-complete', (data) => {
            if (data.campaignId === this.campaign.id) {
                this.campaign.isActive = false;
                this.campaign.sent = data.successful || 0;
                this.campaign.failed = data.failed || 0;
                
                // Update final progress
                this.updateCampaignProgress();
                
                // Update rotation stats with server data
                if (data.rotationStats) {
                    Object.entries(data.rotationStats.deviceUsage || {}).forEach(([deviceId, count]) => {
                        this.rotationStats.deviceUsage.set(deviceId, count);
                    });
                }
                
                this.updateCampaignComplete(data);
                
                // Show restart button for completed campaigns
                const restartBtn = document.getElementById('restart-campaign-btn');
                if (restartBtn) {
                    restartBtn.style.display = 'inline-block';
                }
                
                // Keep campaign progress visible with restart option
                // Don't auto-hide after completion
                
                this.showToast('Success', `Campaign "${data.campaignName}" completed! Sent: ${data.successful}, Failed: ${data.failed}`, 'success');
            }
        });
        
        this.socket.on('campaign-stopped', (data) => {
            if (data.campaignId === this.campaign.id) {
                this.campaign.isActive = false;
                
                const progressSection = document.getElementById('campaign-progress');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
                
                this.showToast('Info', `Campaign "${data.campaignName}" stopped successfully`, 'info');
            }
        });
        
        // Campaign restart event
        this.socket.on('campaign-restarted', (data) => {
            if (data.campaignId === this.campaign.id) {
                // Reset campaign progress
                this.campaign.isActive = true;
                this.campaign.sent = 0;
                this.campaign.failed = 0;
                this.campaign.total = data.total || this.campaign.total;
                
                // Show campaign progress
                this.showCampaignProgress();
                this.updateCampaignProgress();
                
                // Update button visibility
                const restartBtn = document.getElementById('restart-campaign-btn');
                if (restartBtn) {
                    restartBtn.style.display = 'none';
                }
                
                this.showToast('Success', `Campaign "${data.campaignName || this.campaign.name}" restarted successfully!`, 'success');
            }
        });
        
        // Campaign recovery event for persistent campaigns
        this.socket.on('active-campaigns-recovered', (data) => {
            if (data.campaigns && data.campaigns.length > 0) {
                const campaign = data.campaigns[0]; // Show the first active campaign
                this.campaign.id = campaign.id;
                this.campaign.isActive = true;
                this.campaign.name = campaign.name;
                this.campaign.total = campaign.progress.total;
                this.campaign.sent = campaign.progress.sent;
                this.campaign.failed = campaign.progress.failed;
                
                this.showCampaignProgress();
                this.updateCampaignProgress();
                
                this.showToast('Info', `Recovered active campaign: "${campaign.name}"`, 'info');
            }
        });
    }

    setupEventListeners() {
        // Device management removed from dashboard - only available on devices.html
        document.getElementById('message-form')?.addEventListener('submit', (e) => this.sendMessage(e));
        document.getElementById('bulk-message-form')?.addEventListener('submit', (e) => this.sendBulk(e));
        document.getElementById('device-select')?.addEventListener('change', (e) => {
            this.selectedDeviceId = e.target.value;
            this.updateSingleMessageButtonState();
        });
        document.getElementById('refresh-devices-btn')?.addEventListener('click', () => this.refreshDevices());
        document.getElementById('copy-user-id-btn')?.addEventListener('click', () => this.copyUserIdToClipboard());
        
        // Single message form event listeners
        document.getElementById('phone-number')?.addEventListener('input', () => this.updateSingleMessageButtonState());
        document.getElementById('message-text')?.addEventListener('input', (e) => {
            this.updateCharCount();
            this.updateSingleMessageButtonState();
        });
        
        // File attachment handling for single message
        document.getElementById('attachment')?.addEventListener('change', (e) => this.handleSingleAttachment(e.target.files[0]));
        document.getElementById('remove-file')?.addEventListener('click', () => this.removeSingleAttachment());
        
        // Bulk SMS Event Listeners
        this.setupBulkSMSEventListeners();
        
        // Sidebar Device Selection & Rotation Event Listeners
        this.setupSidebarEventListeners();
    }

    // Device creation functions removed - only available on devices.html
    // Users should use the dedicated Devices page for device management

    async sendMessage(e) {
        e.preventDefault();
        
        const deviceId = document.getElementById('device-select').value;
        const phoneNumber = document.getElementById('phone-number').value;
        const messageText = document.getElementById('message-text').value;
        const recipientName = document.getElementById('recipient-name').value;
        const recipientCity = document.getElementById('recipient-city').value;
        const recipientOrder = document.getElementById('recipient-order').value;
        const attachment = document.getElementById('attachment').files[0];
        
        // Validate inputs
        if (!deviceId) {
            this.showToast('Error', 'Please select a device', 'error');
            return;
        }
        
        if (!phoneNumber || !messageText) {
            this.showToast('Error', 'Please fill in phone number and message', 'error');
            return;
        }
        
        try {
            // Disable send button
            const sendBtn = document.getElementById('send-btn');
            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Sending...';
            }
            
            // Personalize message with variables
            let personalizedMessage = messageText;
            personalizedMessage = personalizedMessage.replace(/\{name\}/g, recipientName || phoneNumber);
            personalizedMessage = personalizedMessage.replace(/\{city\}/g, recipientCity || '');
            personalizedMessage = personalizedMessage.replace(/\{order\}/g, recipientOrder || '');
            personalizedMessage = personalizedMessage.replace(/\{mobile\}/g, phoneNumber || '');
            
            const formData = new FormData();
            formData.append('deviceId', deviceId);
            formData.append('phoneNumber', phoneNumber);
            formData.append('message', personalizedMessage);
            
            if (attachment) {
                formData.append('attachment', attachment);
            }
            
            const response = await fetch('/send-message', { 
                method: 'POST', 
                body: formData 
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showToast('Success', 'Message sent successfully!', 'success');
                // Clear form
                document.getElementById('message-form').reset();
                document.getElementById('file-preview').style.display = 'none';
                this.updateCharCount();
            } else {
                throw new Error(result.error || 'Failed to send message');
            }
            
        } catch (error) {
            console.error('Error sending message:', error);
            this.showToast('Error', 'Failed to send message: ' + error.message, 'error');
        } finally {
            // Re-enable send button
            const sendBtn = document.getElementById('send-btn');
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>Send Message';
                this.updateSingleMessageButtonState();
            }
        }
    }

    async sendBulk(e) {
        e.preventDefault();
        const formData = new FormData();
        formData.append('userId', this.userId);
        formData.append('message', document.getElementById('bulk-message-text').value);
        formData.append('csvFile', document.getElementById('csv-file').files[0]);
        
        try {
            await fetch('/send-bulk-messages', { method: 'POST', body: formData });
            this.showToast('Success', 'Bulk messaging started!');
        } catch (error) {
            this.showToast('Error', error.message);
        }
    }

    // Single message utility functions
    updateSingleMessageButtonState() {
        const sendBtn = document.getElementById('send-btn');
        const deviceSelect = document.getElementById('device-select');
        const phoneNumber = document.getElementById('phone-number');
        const messageText = document.getElementById('message-text');
        
        if (sendBtn) {
            const hasDevice = deviceSelect && deviceSelect.value;
            const hasPhone = phoneNumber && phoneNumber.value.trim();
            const hasMessage = messageText && messageText.value.trim();
            
            sendBtn.disabled = !(hasDevice && hasPhone && hasMessage);
        }
    }
    
    updateCharCount() {
        const messageText = document.getElementById('message-text');
        const charCount = document.getElementById('char-count');
        
        if (messageText && charCount) {
            charCount.textContent = messageText.value.length;
        }
    }
    
    handleSingleAttachment(file) {
        if (!file) return;
        
        // Check file size (10MB limit)
        if (file.size > 10 * 1024 * 1024) {
            this.showToast('Error', 'File size must be less than 10MB', 'error');
            document.getElementById('attachment').value = '';
            return;
        }
        
        const fileName = document.getElementById('file-name');
        const filePreview = document.getElementById('file-preview');
        
        if (fileName && filePreview) {
            fileName.textContent = `${file.name} (${this.formatFileSize(file.size)})`;
            filePreview.style.display = 'block';
        }
    }
    
    removeSingleAttachment() {
        document.getElementById('attachment').value = '';
        document.getElementById('file-preview').style.display = 'none';
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    updateDevicesList(devices) {
        this.devices.clear();
        devices.forEach(d => this.devices.set(d.id, d));
        
        // Update device statistics
        const readyDevices = devices.filter(d => d.isReady);
        const connectingDevices = devices.filter(d => !d.isReady && d.status !== 'disconnected');
        const totalDevices = devices.length;
        
        // Update header device count
        const deviceCountEl = document.getElementById('device-count');
        if (deviceCountEl) {
            deviceCountEl.textContent = totalDevices;
        }
        
        // Update device statistics in sidebar
        const readyEl = document.getElementById('ready-devices');
        const connectingEl = document.getElementById('connecting-devices');
        const totalEl = document.getElementById('total-devices');
        
        if (readyEl) readyEl.textContent = readyDevices.length;
        if (connectingEl) connectingEl.textContent = connectingDevices.length;
        if (totalEl) totalEl.textContent = totalDevices;
        
        // Update devices list
        const list = document.getElementById('devices-list');
        if (list) {
            if (devices.length === 0) {
                list.innerHTML = `
                    <div class="text-muted text-center p-3">
                        <i class="fas fa-mobile-alt fa-2x mb-2"></i>
                        <p>No devices connected yet.<br>Go to <a href="devices.html" class="text-decoration-none"><strong>Devices</strong></a> page to add WhatsApp devices.</p>
                    </div>
                `;
            } else {
                list.innerHTML = devices.map(d => `
                    <div class="border p-2 mb-2 rounded ${d.isReady ? 'border-success' : 'border-warning'}">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <strong>${d.name}</strong>
                                ${d.phoneNumber ? `<br><small class="text-muted">${d.phoneNumber}</small>` : ''}
                            </div>
                            <div class="text-end">
                                <span class="badge bg-${d.isReady ? 'success' : 'warning'}">
                                    <i class="fas fa-${d.isReady ? 'check-circle' : 'spinner fa-spin'} me-1"></i>
                                    ${d.isReady ? 'Ready' : 'Connecting'}
                                </span>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        }

        // Update device select dropdown
        const select = document.getElementById('device-select');
        if (select) {
            if (readyDevices.length === 0) {
                select.innerHTML = '<option value="">No devices ready</option>';
            } else {
                select.innerHTML = '<option value="">Select a device...</option>' + 
                    readyDevices.map(d => `<option value="${d.id}">${d.name} ${d.phoneNumber ? '(' + d.phoneNumber + ')' : ''}</option>`).join('');
            }
        }
        
        // Update bulk SMS device counts - removed since duplicate panel was removed
        // const totalReadyEl = document.getElementById('total-ready-devices');
        // if (totalReadyEl) totalReadyEl.textContent = readyDevices.length;
        
        // Update sidebar device counts
        const totalReadySidebarEl = document.getElementById('total-ready-devices-sidebar');
        if (totalReadySidebarEl) totalReadySidebarEl.textContent = readyDevices.length;
        
        // Auto-select devices if not manual strategy for bulk SMS
        const strategy = document.getElementById('rotation-strategy')?.value;
        if (strategy && strategy !== 'manual') {
            this.autoSelectBulkDevices();
        } else if (strategy === 'manual') {
            // Restore saved device selections for manual strategy
            if (this.rotationSettings.selectedDevices.length > 0) {
                this.selectedDevices.clear();
                this.rotationSettings.selectedDevices.forEach(deviceId => {
                    if (readyDevices.find(d => d.id === deviceId)) {
                        this.selectedDevices.add(deviceId);
                    }
                });
            }
            this.renderSidebarDeviceCheckboxes();
        }
        
        // Handle sidebar strategy
        const sidebarStrategy = document.getElementById('rotation-strategy-sidebar')?.value;
        console.log('Sidebar strategy:', sidebarStrategy);
        console.log('Ready devices count:', readyDevices.length);
        
        if (sidebarStrategy && sidebarStrategy !== 'manual') {
            console.log('Auto-selecting devices for non-manual sidebar strategy');
            this.autoSelectBulkDevices();
        } else if (sidebarStrategy === 'manual') {
            console.log('Manual strategy selected, rendering checkboxes');
            // Restore saved device selections for manual strategy
            if (this.rotationSettings.selectedDevices.length > 0) {
                console.log('Restoring saved device selections:', this.rotationSettings.selectedDevices);
                this.selectedDevices.clear();
                this.rotationSettings.selectedDevices.forEach(deviceId => {
                    if (readyDevices.find(d => d.id === deviceId)) {
                        this.selectedDevices.add(deviceId);
                        console.log('Restored device selection:', deviceId);
                    }
                });
            } else {
                console.log('No saved device selections found');
            }
            this.renderSidebarDeviceCheckboxes();
        }
        
        this.updateSelectedDevicesCount();
        this.updateSendButtonState();
        this.updateSingleMessageButtonState();
        
        // Update sidebar counts as well
        this.updateSidebarSelectedDevicesCount();
        
        // Update rotation display
        this.updateRotationDisplay();
    }

    updateUserDisplay() {
        const userDisplay = document.getElementById('user-display-name');
        const userIdDisplay = document.getElementById('user-id-display');
        const userIdInput = document.getElementById('user-id-input');
        
        // Simply display the user ID since we're not using authentication
        if (userDisplay) {
            userDisplay.textContent = this.userId || 'User';
        }
        if (userIdDisplay) {
            userIdDisplay.textContent = this.userId;
        }
        if (userIdInput) {
            userIdInput.value = this.userId;
        }
    }

    showQR(qrCode, deviceId = null) {
        const container = document.getElementById('device-qr-container');
        if (container) {
            container.innerHTML = `
                <div class="text-center">
                    <img src="${qrCode}" style="max-width:300px; width: 100%;" class="img-fluid rounded">
                    <div class="mt-3">
                        <p class="text-muted">Scan this QR code with WhatsApp on your mobile device</p>
                        <div class="spinner-border spinner-border-sm text-primary" role="status">
                            <span class="visually-hidden">Waiting for scan...</span>
                        </div>
                    </div>
                </div>
            `;
        }
        
        const modal = document.getElementById('deviceQRModal');
        if (modal) {
            new bootstrap.Modal(modal).show();
        }
    }

    showToast(title, message, type = 'info') {
        const toast = document.getElementById('toast');
        const toastTitle = document.getElementById('toast-title');
        const toastBody = document.getElementById('toast-body');
        const toastIcon = document.getElementById('toast-icon');
        
        if (toast && toastTitle && toastBody) {
            toastTitle.textContent = title;
            toastBody.textContent = message;
            
            if (toastIcon) {
                // Set icon based on type
                switch (type) {
                    case 'success':
                        toastIcon.className = 'fas fa-check-circle text-success me-2';
                        break;
                    case 'error':
                        toastIcon.className = 'fas fa-exclamation-circle text-danger me-2';
                        break;
                    case 'warning':
                        toastIcon.className = 'fas fa-exclamation-triangle text-warning me-2';
                        break;
                    default:
                        toastIcon.className = 'fas fa-info-circle text-info me-2';
                }
            }
            
            new bootstrap.Toast(toast).show();
        }
    }

    // Add disconnect method for cleanup
    disconnect() {
        if (this.socket && this.socket.connected) {
            console.log('Disconnecting socket for cleanup');
            this.socket.disconnect();
            window.socketConnectionActive = false; // Reset flag
        }
    }

    refreshDevices() { 
        this.socket.emit('identify-user', { userId: this.userId }); 
    }

    updateConnectionStatus(status) {
        const connectionStatus = document.getElementById('connection-status');
        if (!connectionStatus) return;
        
        const badge = connectionStatus.querySelector('.badge');
        if (status === 'connected') {
            badge.className = 'badge bg-success';
            badge.innerHTML = '<i class="fas fa-check-circle me-1"></i>Connected';
        } else if (status === 'disconnected') {
            badge.className = 'badge bg-danger';
            badge.innerHTML = '<i class="fas fa-times-circle me-1"></i>Disconnected';
        } else {
            badge.className = 'badge bg-warning';
            badge.innerHTML = '<i class="fas fa-circle-notch fa-spin me-1"></i>Connecting...';
        }
    }

    copyUserIdToClipboard() {
        const userIdInput = document.getElementById('user-id-input');
        if (userIdInput) {
            userIdInput.select();
            navigator.clipboard.writeText(userIdInput.value).then(() => {
                this.showToast('Success', 'User ID copied to clipboard!');
            }).catch(() => {
                // Fallback for older browsers
                document.execCommand('copy');
                this.showToast('Success', 'User ID copied to clipboard!');
            });
        }
    }

    // Bulk SMS Methods
    setupBulkSMSEventListeners() {
        // CSV file upload
        document.getElementById('csv-file')?.addEventListener('change', (e) => {
            this.handleCSVUpload(e.target.files[0]);
        });
        
        // Manual number input
        document.getElementById('manual-numbers-input')?.addEventListener('input', () => {
            this.updateManualCount();
        });
        
        document.getElementById('parse-manual-numbers')?.addEventListener('click', () => {
            this.parseManualNumbers();
        });
        
        document.getElementById('clear-manual-numbers')?.addEventListener('click', () => {
            this.clearManualNumbers();
        });
        
        document.getElementById('preview-manual-numbers')?.addEventListener('click', () => {
            this.showManualRecipientsPreview();
        });
        
        // Tab switching
        document.getElementById('manual-input-tab')?.addEventListener('click', () => {
            this.switchInputMethod('manual');
        });
        
        document.getElementById('csv-upload-tab')?.addEventListener('click', () => {
            this.switchInputMethod('csv');
        });

        // Attachment upload
        document.getElementById('bulk-attachment')?.addEventListener('change', (e) => {
            this.handleAttachmentUpload(e.target.files[0]);
        });

        // Remove attachment
        document.getElementById('remove-attachment')?.addEventListener('click', () => {
            this.removeAttachment();
        });

        // Message template character count
        document.getElementById('message-template')?.addEventListener('input', (e) => {
            document.getElementById('char-count-bulk').textContent = e.target.value.length;
            this.updateSendButtonState();
        });

        // Preview recipients
        document.getElementById('preview-recipients')?.addEventListener('click', () => {
            this.showRecipientsPreview('csv');
        });
        
        document.getElementById('preview-all-recipients')?.addEventListener('click', () => {
            this.showRecipientsPreview('all');
        });
        
        document.getElementById('clear-all-recipients')?.addEventListener('click', () => {
            this.clearAllRecipients();
        });

        // Download CSV template
        document.getElementById('download-csv-template')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.downloadCSVTemplate();
        });

        // Form submission (bulk SMS)
        document.getElementById('bulk-sms-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.startCampaign();
        });

        // Stop campaign
        document.getElementById('stop-campaign-btn')?.addEventListener('click', () => {
            this.stopCampaign();
        });
        
        // Restart campaign
        document.getElementById('restart-campaign-btn')?.addEventListener('click', () => {
            this.restartCampaign();
        });
    }

    // Sidebar Device Selection & Rotation Event Listeners
    setupSidebarEventListeners() {
        // Sidebar rotation strategy change with auto-save
        document.getElementById('rotation-strategy-sidebar')?.addEventListener('change', (e) => {
            console.log('Sidebar rotation strategy changed to:', e.target.value);
            this.handleSidebarRotationStrategyChange(e.target.value);
            // Save rotation strategy setting
            this.rotationSettings.strategy = e.target.value;
            this.saveRotationSettings();
        });



        // Sidebar messages per device input with auto-save
        document.getElementById('messages-per-device-sidebar')?.addEventListener('change', (e) => {
            const value = parseInt(e.target.value) || 10;
            this.campaign.deviceRotation.messagesPerDevice = value;
            // Save messages per device setting
            this.rotationSettings.messagesPerDevice = value;
            this.saveRotationSettings();
            // Sync with bulk SMS tab
            const bulkInput = document.getElementById('messages-per-device');
            if (bulkInput) bulkInput.value = e.target.value;
        });

        // Sidebar custom delay toggle
        document.getElementById('message-delay-sidebar')?.addEventListener('change', (e) => {
            const customDelayDiv = document.getElementById('custom-delay-sidebar');
            if (e.target.value === 'custom') {
                customDelayDiv.style.display = 'block';
            } else {
                customDelayDiv.style.display = 'none';
            }
            // Sync with bulk SMS tab
            const bulkDelay = document.getElementById('message-delay');
            if (bulkDelay) bulkDelay.value = e.target.value;
        });
        
        // Debug manual selection button
        document.getElementById('debug-manual-selection-btn')?.addEventListener('click', () => {
            this.debugManualSelection();
        });
    }

    debugManualSelection() {
        console.log('=== Manual Selection Debug ===');
        console.log('Total devices:', this.devices.size);
        console.log('Ready devices:', Array.from(this.devices.values()).filter(d => d.isReady).length);
        console.log('Selected devices:', this.selectedDevices.size);
        console.log('Current strategy:', document.getElementById('rotation-strategy-sidebar')?.value);
        
        const manualSelection = document.getElementById('manual-device-selection-sidebar');
        const container = document.getElementById('device-checkboxes-sidebar');
        
        console.log('Manual selection div display:', manualSelection?.style.display);
        console.log('Container HTML length:', container?.innerHTML?.length);
        console.log('Container content:', container?.innerHTML);
        
        // Force re-render
        console.log('Force re-rendering checkboxes...');
        this.renderSidebarDeviceCheckboxes();
        
        this.showToast('Debug', 'Check browser console for manual selection debug info', 'info');
    }

    // Random delay calculation function
    calculateMessageDelay(delayOption) {
        // Use saved settings if no option specified
        const selectedDelay = delayOption || this.delaySettings.selectedOption;
        
        switch (selectedDelay) {
            case 'random-fast':
                return Math.floor(Math.random() * (5000 - 2000 + 1)) + 2000; // 2-5 seconds
            case 'random-normal':
                return Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000; // 5-10 seconds
            case 'random-safe':
                return Math.floor(Math.random() * (20000 - 10000 + 1)) + 10000; // 10-20 seconds
            case 'custom':
                // Use saved custom delay settings
                const minDelaySeconds = this.delaySettings.customMinDelay;
                const maxDelaySeconds = this.delaySettings.customMaxDelay;
                // Convert seconds to milliseconds
                const minDelay = minDelaySeconds * 1000;
                const maxDelay = maxDelaySeconds * 1000;
                return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
            default:
                return parseInt(selectedDelay) || 2000;
        }
    }

    handleSidebarRotationStrategyChange(strategy) {
        console.log('=== Sidebar Rotation Strategy Change ===');
        console.log('New strategy:', strategy);
        
        this.campaign.deviceRotation.strategy = strategy;
        
        const manualSelection = document.getElementById('manual-device-selection-sidebar');
        const customCountSettings = document.getElementById('custom-count-settings-sidebar');
        
        console.log('Manual selection element found:', !!manualSelection);
        console.log('Custom count settings element found:', !!customCountSettings);
        
        // Hide all sections first
        if (manualSelection) manualSelection.style.display = 'none';
        if (customCountSettings) customCountSettings.style.display = 'none';
        
        if (strategy === 'manual') {
            console.log('Showing manual device selection');
            if (manualSelection) {
                manualSelection.style.display = 'block';
                // Render checkboxes after a small delay to ensure DOM is ready
                setTimeout(() => {
                    this.renderSidebarDeviceCheckboxes();
                }, 100);
            }
        } else if (strategy === 'custom-count') {
            console.log('Showing custom count settings');
            if (customCountSettings) customCountSettings.style.display = 'block';
            this.autoSelectBulkDevices();
        } else {
            console.log('Using automatic device selection for strategy:', strategy);
            this.autoSelectBulkDevices();
        }
        
        this.updateSidebarSelectedDevicesCount();
        console.log('=== End Sidebar Strategy Change ===');
    }

    renderSidebarDeviceCheckboxes() {
        const container = document.getElementById('device-checkboxes-sidebar');
        if (!container) {
            console.log('Device checkboxes container not found');
            return;
        }
        
        const readyDevices = Array.from(this.devices.values()).filter(d => d.isReady);
        console.log('Rendering sidebar device checkboxes for', readyDevices.length, 'ready devices');
        
        if (readyDevices.length === 0) {
            container.innerHTML = '<div class="text-muted">No ready devices available</div>';
            console.log('No ready devices available');
            return;
        }
        
        const checkboxesHtml = readyDevices.map(device => {
            const isSelected = this.selectedDevices.has(device.id);
            console.log(`Device ${device.name} (${device.id}): selected = ${isSelected}`);
            return `
                <div class="form-check">
                    <input class="form-check-input device-checkbox-sidebar" type="checkbox" 
                           value="${device.id}" id="sidebar-device-${device.id}"
                           ${isSelected ? 'checked' : ''}>
                    <label class="form-check-label" for="sidebar-device-${device.id}">
                        <small>${device.name} ${device.phoneNumber ? `(${device.phoneNumber})` : ''}</small>
                    </label>
                </div>
            `;
        }).join('');
        
        console.log('Setting checkbox HTML:', checkboxesHtml);
        container.innerHTML = checkboxesHtml;
        
        // Add event listeners for checkboxes with auto-save
        container.querySelectorAll('.device-checkbox-sidebar').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                console.log('Checkbox changed:', e.target.value, e.target.checked);
                if (e.target.checked) {
                    this.selectedDevices.add(e.target.value);
                } else {
                    this.selectedDevices.delete(e.target.value);
                }
                this.updateSidebarSelectedDevicesCount();
                this.updateSelectedDevicesCount();
                this.updateSendButtonState();
                // Auto-save selected devices
                this.rotationSettings.selectedDevices = Array.from(this.selectedDevices);
                this.saveRotationSettings();
            });
        });
    }

    updateSidebarSelectedDevicesCount() {
        const countEl = document.getElementById('selected-devices-count-sidebar');
        if (countEl) countEl.textContent = this.selectedDevices.size;
    }

    handleRotationStrategyChange(strategy) {
        this.campaign.deviceRotation.strategy = strategy;
        
        const manualSelection = document.getElementById('manual-device-selection-sidebar');
        const customCountSettings = document.getElementById('custom-count-settings-sidebar');
        
        if (strategy === 'manual') {
            manualSelection.style.display = 'block';
            customCountSettings.style.display = 'none';
            this.renderSidebarDeviceCheckboxes();
        } else if (strategy === 'custom-count') {
            manualSelection.style.display = 'none';
            customCountSettings.style.display = 'block';
            // Auto-select all ready devices for custom count strategy
            this.autoSelectBulkDevices();
        } else {
            manualSelection.style.display = 'none';
            customCountSettings.style.display = 'none';
            // Auto-select all ready devices for other strategies
            this.autoSelectBulkDevices();
        }
        
        this.updateSidebarSelectedDevicesCount();
    }

    autoSelectBulkDevices() {
        this.selectedDevices.clear();
        Array.from(this.devices.values())
            .filter(d => d.isReady)
            .forEach(d => this.selectedDevices.add(d.id));
        
        // Auto-save selected devices
        this.rotationSettings.selectedDevices = Array.from(this.selectedDevices);
        this.saveRotationSettings();
    }

    updateSelectedDevicesCount() {
        // This method is no longer needed since we removed the bulk SMS duplicate panel
        // const countEl = document.getElementById('selected-devices-count');
        // if (countEl) countEl.textContent = this.selectedDevices.size;
    }

    switchInputMethod(method) {
        this.currentInputMethod = method;
        this.updateTotalRecipients();
    }

    updateManualCount() {
        const input = document.getElementById('manual-numbers-input');
        const countEl = document.getElementById('manual-count');
        if (input && countEl) {
            const lines = input.value.trim().split('\n').filter(line => line.trim());
            countEl.textContent = lines.length;
        }
    }

    parseManualNumbers() {
        const input = document.getElementById('manual-numbers-input');
        if (!input) return;
        
        const lines = input.value.trim().split('\n');
        this.manualRecipients = [];
        
        lines.forEach(line => {
            line = line.trim();
            if (!line) return;
            
            // Parse format: +number,name,city,order
            const parts = line.split(',').map(part => part.trim());
            if (parts.length >= 1 && parts[0]) {
                this.manualRecipients.push({
                    phoneNumber: parts[0],
                    name: parts[1] || parts[0],
                    city: parts[2] || '',
                    order: parts[3] || ''
                });
            }
        });
        
        document.getElementById('manual-parsed-count').textContent = this.manualRecipients.length;
        document.getElementById('manual-preview').style.display = 'block';
        
        this.updateTotalRecipients();
        this.showToast('Success', `Parsed ${this.manualRecipients.length} contacts`, 'success');
    }

    clearManualNumbers() {
        document.getElementById('manual-numbers-input').value = '';
        document.getElementById('manual-preview').style.display = 'none';
        this.manualRecipients = [];
        this.updateManualCount();
        this.updateTotalRecipients();
        this.showToast('Info', 'Manual numbers cleared!', 'info');
    }

    showManualRecipientsPreview() {
        this.showRecipientsPreview('manual');
    }

    async handleCSVUpload(file) {
        if (!file) return;
        
        try {
            const text = await file.text();
            this.csvRecipients = this.parseCSV(text);
            
            document.getElementById('csv-count').textContent = this.csvRecipients.length;
            document.getElementById('csv-preview').style.display = 'block';
            
            this.updateTotalRecipients();
            this.showToast('Success', `${this.csvRecipients.length} recipients loaded from CSV`, 'success');
            
        } catch (error) {
            this.showToast('Error', 'Failed to parse CSV file: ' + error.message, 'error');
        }
    }

    parseCSV(text) {
        const lines = text.trim().split('\n');
        const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
        
        const phoneIndex = headers.findIndex(h => 
            h.includes('phone') || h.includes('number') || h.includes('mobile')
        );
        const nameIndex = headers.findIndex(h => 
            h.includes('name') || h.includes('contact')
        );
        const cityIndex = headers.findIndex(h => 
            h.includes('city') || h.includes('location')
        );
        const orderIndex = headers.findIndex(h => 
            h.includes('order') || h.includes('id')
        );
        
        if (phoneIndex === -1) {
            throw new Error('CSV must contain a phone number column');
        }
        
        const recipients = [];
        
        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].split(',').map(cell => cell.trim().replace(/"/g, ''));
            
            if (row[phoneIndex]) {
                recipients.push({
                    phoneNumber: row[phoneIndex].replace(/\D/g, ''),
                    name: nameIndex !== -1 ? (row[nameIndex] || row[phoneIndex]) : row[phoneIndex],
                    city: cityIndex !== -1 ? (row[cityIndex] || '') : '',
                    order: orderIndex !== -1 ? (row[orderIndex] || '') : ''
                });
            }
        }
        
        return recipients;
    }

    handleAttachmentUpload(file) {
        if (!file) return;
        
        // Check file size (10MB limit)
        if (file.size > 10 * 1024 * 1024) {
            this.showToast('Error', 'File size must be less than 10MB', 'error');
            document.getElementById('bulk-attachment').value = '';
            return;
        }
        
        document.getElementById('attachment-name').textContent = `${file.name} (${this.formatFileSize(file.size)})`;
        document.getElementById('attachment-preview').style.display = 'block';
    }

    removeAttachment() {
        document.getElementById('bulk-attachment').value = '';
        document.getElementById('attachment-preview').style.display = 'none';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    updateTotalRecipients() {
        // Combine recipients from both sources
        this.recipients = [];
        
        if (this.currentInputMethod === 'manual') {
            this.recipients = [...this.manualRecipients];
        } else {
            this.recipients = [...this.csvRecipients];
        }
        
        // Show summary if we have recipients
        const totalCount = this.recipients.length;
        const totalCountEl = document.getElementById('total-recipients-count');
        if (totalCountEl) totalCountEl.textContent = totalCount;
        
        const summaryEl = document.getElementById('recipients-summary');
        if (summaryEl) {
            if (totalCount > 0) {
                summaryEl.style.display = 'block';
            } else {
                summaryEl.style.display = 'none';
            }
        }
        
        this.updateSendButtonState();
    }

    clearAllRecipients() {
        this.manualRecipients = [];
        this.csvRecipients = [];
        this.recipients = [];
        
        // Clear UI elements
        document.getElementById('manual-numbers-input').value = '';
        document.getElementById('csv-file').value = '';
        document.getElementById('manual-preview').style.display = 'none';
        document.getElementById('csv-preview').style.display = 'none';
        document.getElementById('recipients-summary').style.display = 'none';
        
        this.updateManualCount();
        this.showToast('Info', 'All recipients cleared!', 'info');
    }

    showRecipientsPreview(source = 'all') {
        let recipientsToShow = [];
        let modalTitle = 'Recipients Preview';
        
        switch (source) {
            case 'manual':
                recipientsToShow = this.manualRecipients;
                modalTitle = 'Manual Recipients Preview';
                break;
            case 'csv':
                recipientsToShow = this.csvRecipients;
                modalTitle = 'CSV Recipients Preview';
                break;
            case 'all':
            default:
                recipientsToShow = this.recipients;
                modalTitle = 'All Recipients Preview';
                break;
        }
        
        const modal = new bootstrap.Modal(document.getElementById('recipientsModal'));
        const tableBody = document.getElementById('recipients-table-body');
        const modalTitleEl = document.querySelector('#recipientsModal .modal-title');
        
        modalTitleEl.innerHTML = `<i class="fas fa-users me-2"></i>${modalTitle} (${recipientsToShow.length})`;
        
        tableBody.innerHTML = recipientsToShow.map((recipient, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${recipient.phoneNumber}</td>
                <td>${recipient.name}</td>
                <td>${recipient.city || '-'}</td>
                <td>${recipient.order || '-'}</td>
            </tr>
        `).join('');
        
        modal.show();
    }

    downloadCSVTemplate() {
        const csv = 'phone,name,city,order\n+1234567890,John Doe,New York,ORD001\n+9876543210,Jane Smith,London,ORD002\n+1122334455,Mike Johnson,Paris,ORD003';
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'recipients-template.csv';
        a.click();
        window.URL.revokeObjectURL(url);
    }

    updateSendButtonState() {
        const button = document.getElementById('start-campaign-btn');
        const messageTemplate = document.getElementById('message-template')?.value?.trim();
        
        if (button) {
            const hasRecipients = this.recipients.length > 0;
            const hasMessage = messageTemplate && messageTemplate.length > 0;
            const hasSelectedDevices = this.selectedDevices.size > 0;
            
            button.disabled = !(hasRecipients && hasMessage && hasSelectedDevices);
        }
    }

    async startCampaign() {
        // Get campaign configuration
        const message = document.getElementById('message-template')?.value?.trim();
        const campaignName = document.getElementById('campaign-name')?.value?.trim() || `Campaign ${Date.now()}`;
        const delayOption = document.getElementById('message-delay-sidebar')?.value || '2000';
        const rotationStrategy = document.getElementById('rotation-strategy-sidebar')?.value || 'round-robin';
        const messagesPerDevice = parseInt(document.getElementById('messages-per-device-sidebar')?.value || 10);
        const customMinDelay = parseInt(document.getElementById('custom-min-delay-sidebar')?.value || 5);
        const customMaxDelay = parseInt(document.getElementById('custom-max-delay-sidebar')?.value || 20);
        const enableTypingSimulation = document.getElementById('typing-simulation')?.checked !== false;
        
        // Validate inputs
        if (!message) {
            this.showToast('Error', 'Please enter a message template', 'error');
            return;
        }
        
        if (this.selectedDevices.size === 0) {
            this.showToast('Error', 'Please select at least one device', 'error');
            return;
        }
        
        // Get recipients list
        const recipients = this.getCurrentRecipients();
        if (recipients.length === 0) {
            this.showToast('Error', 'Please add recipients (manual or CSV)', 'error');
            return;
        }
        
        try {
            // Prepare campaign data for persistent server-side processing
            const formData = new FormData();
            
            // Generate CSV content from recipients
            const csvContent = this.generateCSVFromRecipients(recipients);
            const csvBlob = new Blob([csvContent], { type: 'text/csv' });
            
            formData.append('userId', this.userId);
            formData.append('message', message);
            formData.append('campaignName', campaignName);
            formData.append('delayOption', delayOption);
            formData.append('rotationStrategy', rotationStrategy);
            formData.append('selectedDevices', JSON.stringify(Array.from(this.selectedDevices)));
            formData.append('messagesPerDevice', messagesPerDevice.toString());
            formData.append('customMinDelay', customMinDelay.toString());
            formData.append('customMaxDelay', customMaxDelay.toString());
            formData.append('enableTypingSimulation', enableTypingSimulation.toString());
            formData.append('csvFile', csvBlob, 'recipients.csv');
            
            // Add attachment if present
            const attachment = document.getElementById('bulk-attachment')?.files[0];
            if (attachment) {
                formData.append('attachment', attachment);
            }
            
            // Show initial progress
            this.campaign.isActive = true;
            this.campaign.name = campaignName;
            this.campaign.total = recipients.length;
            this.campaign.sent = 0;
            this.campaign.failed = 0;
            this.showCampaignProgress();
            
            // Start persistent campaign on server
            const response = await fetch('/send-bulk-messages', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server error response:', errorText);
                throw new Error(`Server error (${response.status}): ${response.statusText}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Unknown server error');
            }
            
            // Store campaign ID for management
            this.campaign.id = result.campaignId;
            
            this.showToast('Success', `Persistent campaign "${campaignName}" started! The campaign will continue even if you close the browser.`, 'success');
            
            // Update rotation stats
            this.rotationStats.activeCampaigns++;
            this.updateRotationDisplay();
            this.saveRotationStats();
            
        } catch (error) {
            console.error('Campaign start error:', error);
            
            this.campaign.isActive = false;
            const progressSection = document.getElementById('campaign-progress');
            if (progressSection) {
                progressSection.style.display = 'none';
            }
            
            let errorMessage = 'Failed to start campaign: ' + error.message;
            
            // Handle common error cases
            if (error.message.includes('HTML instead of JSON')) {
                errorMessage = 'Server configuration error. Please check if all required fields are provided and try again.';
            } else if (error.message.includes('No ready WhatsApp devices')) {
                errorMessage = 'No WhatsApp devices are connected. Please connect at least one device first.';
            } else if (error.message.includes('CSV file is required')) {
                errorMessage = 'Please select recipients using manual input or upload a CSV file.';
            } else if (error.message.includes('Missing required fields')) {
                errorMessage = 'Please fill in all required fields (recipients and message).';
            }
            
            this.showToast('Error', errorMessage, 'error');
        }
    }

    stopCampaign() {
        // Stop persistent campaign on server
        if (this.campaign.id && this.campaign.isActive) {
            this.socket.emit('stop-campaign', {
                campaignId: this.campaign.id
            });
        }
        
        // Update local state
        this.campaign.isActive = false;
        
        // Hide campaign progress immediately
        const progressSection = document.getElementById('campaign-progress');
        if (progressSection) {
            progressSection.style.display = 'none';
        }
        
        // Update statistics
        if (this.rotationStats.activeCampaigns > 0) {
            this.rotationStats.activeCampaigns--;
        }
        this.updateRotationDisplay();
        this.saveRotationStats();
        
        this.showToast('Info', 'Campaign stop request sent. The campaign will be stopped on the server.', 'info');
    }
    
    restartCampaign() {
        // Restart persistent campaign on server
        if (this.campaign.id && !this.campaign.isActive) {
            if (confirm('Are you sure you want to restart this campaign? This will reset all progress and start sending messages again.')) {
                this.socket.emit('restart-campaign', {
                    campaignId: this.campaign.id
                });
                
                this.showToast('Info', 'Campaign restart request sent. The campaign will be restarted on the server.', 'info');
            }
        } else {
            this.showToast('Warning', 'Cannot restart: Campaign is still active or no campaign ID found.', 'warning');
        }
    }

    // Helper methods for campaign functionality
    getCurrentRecipients() {
        if (this.currentInputMethod === 'manual') {
            return this.manualRecipients;
        } else {
            return this.csvRecipients;
        }
    }

    // Helper method to generate CSV from recipients array
    generateCSVFromRecipients(recipients) {
        const csvLines = ['phone,name,city,order'];
        recipients.forEach(recipient => {
            const phone = recipient.phoneNumber.replace(/["]/g, '""');
            const name = (recipient.name || recipient.phoneNumber).replace(/["]/g, '""');
            const city = (recipient.city || '').replace(/["]/g, '""');
            const order = (recipient.order || '').replace(/["]/g, '""');
            csvLines.push(`"${phone}","${name}","${city}","${order}"`);
        });
        return csvLines.join('\n');
    }
    
    showCampaignProgress() {
        const progressSection = document.getElementById('campaign-progress');
        if (progressSection) {
            progressSection.style.display = 'block';
            document.getElementById('campaign-name-display').textContent = this.campaign.name;
        }
        
        // Ensure restart button is hidden for active campaigns
        const restartBtn = document.getElementById('restart-campaign-btn');
        if (restartBtn) {
            restartBtn.style.display = this.campaign.isActive ? 'none' : 'inline-block';
        }
        
        this.updateCampaignProgress();
    }
    
    updateCampaignProgress() {
        // Update progress bar and statistics
        const progressPercent = this.campaign.total > 0 ? (this.campaign.sent / this.campaign.total * 100) : 0;
        
        const progressBar = document.getElementById('progress-bar');
        const progressPercentageEl = document.getElementById('progress-percentage');
        const totalMessagesEl = document.getElementById('total-messages');
        const sentMessagesEl = document.getElementById('sent-messages');
        const failedMessagesEl = document.getElementById('failed-messages');
        const remainingMessagesEl = document.getElementById('remaining-messages');
        
        if (progressBar) progressBar.style.width = `${progressPercent}%`;
        if (progressPercentageEl) progressPercentageEl.textContent = `${Math.round(progressPercent)}%`;
        if (totalMessagesEl) totalMessagesEl.textContent = this.campaign.total;
        if (sentMessagesEl) sentMessagesEl.textContent = this.campaign.sent;
        if (failedMessagesEl) failedMessagesEl.textContent = this.campaign.failed;
        if (remainingMessagesEl) remainingMessagesEl.textContent = this.campaign.total - this.campaign.sent - this.campaign.failed;
    }

    // Device Rotation Statistics Methods
    updateRotationStats(data) {
        if (data.strategy) {
            this.rotationStats.strategy = data.strategy;
            this.updateRotationDisplay();
        }
        if (data.campaignStarted) {
            this.rotationStats.activeCampaigns++;
            this.updateRotationDisplay();
        }
    }

    incrementMessageCount(data) {
        this.rotationStats.totalMessagesSent++;
        
        // Update device usage statistics
        if (data.deviceId) {
            const currentUsage = this.rotationStats.deviceUsage.get(data.deviceId) || 0;
            this.rotationStats.deviceUsage.set(data.deviceId, currentUsage + 1);
        }
        
        this.updateRotationDisplay();
        this.saveRotationStats();
    }

    updateCampaignComplete(data) {
        if (this.rotationStats.activeCampaigns > 0) {
            this.rotationStats.activeCampaigns--;
        }
        this.updateRotationDisplay();
        this.saveRotationStats();
    }

    updateRotationStrategy(data) {
        this.rotationStats.strategy = data.strategy || 'round-robin';
        this.updateRotationDisplay();
        this.saveRotationStats();
    }

    updateRotationDisplay() {
        // Update strategy display
        const strategyEl = document.getElementById('current-strategy');
        if (strategyEl) {
            const strategyNames = {
                'round-robin': 'Round Robin',
                'random': 'Random',
                'load-balanced': 'Load Balanced',
                'custom-count': 'Custom Count',
                'manual': 'Manual Selection'
            };
            strategyEl.textContent = strategyNames[this.rotationStats.strategy] || 'Round Robin';
            strategyEl.className = `badge fs-6 me-2 bg-${this.getStrategyColor(this.rotationStats.strategy)}`;
        }

        // Update statistics
        const totalMsgEl = document.getElementById('total-messages-sent');
        const activeCampaignsEl = document.getElementById('active-campaigns');
        
        if (totalMsgEl) totalMsgEl.textContent = this.rotationStats.totalMessagesSent;
        if (activeCampaignsEl) activeCampaignsEl.textContent = this.rotationStats.activeCampaigns;
        
        // Update sidebar statistics
        const totalMsgSidebarEl = document.getElementById('total-messages-sent-sidebar');
        const activeCampaignsSidebarEl = document.getElementById('active-campaigns-sidebar');
        
        if (totalMsgSidebarEl) totalMsgSidebarEl.textContent = this.rotationStats.totalMessagesSent;
        if (activeCampaignsSidebarEl) activeCampaignsSidebarEl.textContent = this.rotationStats.activeCampaigns;

        // Update device usage chart
        this.updateDeviceUsageChart();
    }

    getStrategyColor(strategy) {
        const colors = {
            'round-robin': 'primary',
            'random': 'warning',
            'load-balanced': 'success',
            'custom-count': 'dark',
            'manual': 'info'
        };
        return colors[strategy] || 'primary';
    }

    updateDeviceUsageChart() {
        const usageSection = document.getElementById('device-usage-section');
        const usageList = document.getElementById('device-usage-list');
        
        if (!usageSection || !usageList) return;

        if (this.rotationStats.deviceUsage.size === 0) {
            usageSection.style.display = 'none';
            return;
        }

        usageSection.style.display = 'block';
        
        const totalMessages = this.rotationStats.totalMessagesSent;
        const usageArray = Array.from(this.rotationStats.deviceUsage.entries())
            .map(([deviceId, count]) => {
                const device = this.devices.get(deviceId);
                return {
                    deviceId,
                    deviceName: device ? device.name : `Device ${deviceId.substring(0, 8)}`,
                    count,
                    percentage: totalMessages > 0 ? Math.round((count / totalMessages) * 100) : 0
                };
            })
            .sort((a, b) => b.count - a.count);

        usageList.innerHTML = usageArray.map(usage => `
            <div class="mb-2">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="fw-bold">${usage.deviceName}</span>
                    <span class="badge bg-secondary">${usage.count} (${usage.percentage}%)</span>
                </div>
                <div class="progress" style="height: 8px;">
                    <div class="progress-bar bg-info" style="width: ${usage.percentage}%"></div>
                </div>
            </div>
        `).join('');
    }

    // Load and save rotation statistics from localStorage
    loadRotationStats() {
        const saved = localStorage.getItem('whatsapp_rotation_stats');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                this.rotationStats.strategy = parsed.strategy || 'round-robin';
                this.rotationStats.totalMessagesSent = parsed.totalMessagesSent || 0;
                this.rotationStats.activeCampaigns = parsed.activeCampaigns || 0;
                
                // Convert device usage array back to Map
                if (parsed.deviceUsage && Array.isArray(parsed.deviceUsage)) {
                    this.rotationStats.deviceUsage = new Map(parsed.deviceUsage);
                }
            } catch (e) {
                console.log('Failed to load rotation stats:', e);
            }
        }
    }

    saveRotationStats() {
        try {
            const toSave = {
                strategy: this.rotationStats.strategy,
                totalMessagesSent: this.rotationStats.totalMessagesSent,
                activeCampaigns: this.rotationStats.activeCampaigns,
                deviceUsage: Array.from(this.rotationStats.deviceUsage.entries())
            };
            localStorage.setItem('whatsapp_rotation_stats', JSON.stringify(toSave));
        } catch (e) {
            console.log('Failed to save rotation stats:', e);
        }
    }

    // Load and save delay settings from localStorage
    loadDelaySettings() {
        const saved = localStorage.getItem('whatsapp_delay_settings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                this.delaySettings.selectedOption = parsed.selectedOption || '2000';
                this.delaySettings.customMinDelay = parsed.customMinDelay || 5;
                this.delaySettings.customMaxDelay = parsed.customMaxDelay || 20;
                
                // Apply saved settings to UI
                const delaySelect = document.getElementById('message-delay-sidebar');
                const minDelayInput = document.getElementById('custom-min-delay-sidebar');
                const maxDelayInput = document.getElementById('custom-max-delay-sidebar');
                const customDelayDiv = document.getElementById('custom-delay-sidebar');
                
                if (delaySelect) {
                    delaySelect.value = this.delaySettings.selectedOption;
                    // Show/hide custom delay inputs based on selection
                    if (customDelayDiv) {
                        customDelayDiv.style.display = this.delaySettings.selectedOption === 'custom' ? 'block' : 'none';
                    }
                }
                if (minDelayInput) minDelayInput.value = this.delaySettings.customMinDelay;
                if (maxDelayInput) maxDelayInput.value = this.delaySettings.customMaxDelay;
                
            } catch (e) {
                console.log('Failed to load delay settings:', e);
            }
        }
    }

    saveDelaySettings() {
        try {
            const toSave = {
                selectedOption: this.delaySettings.selectedOption,
                customMinDelay: this.delaySettings.customMinDelay,
                customMaxDelay: this.delaySettings.customMaxDelay
            };
            localStorage.setItem('whatsapp_delay_settings', JSON.stringify(toSave));
            this.showToast('Success', 'Delay settings saved!', 'success');
        } catch (e) {
            console.log('Failed to save delay settings:', e);
        }
    }

    // Load and save rotation settings from localStorage
    loadRotationSettings() {
        const saved = localStorage.getItem('whatsapp_rotation_settings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                this.rotationSettings.strategy = parsed.strategy || 'round-robin';
                this.rotationSettings.messagesPerDevice = parsed.messagesPerDevice || 10;
                this.rotationSettings.selectedDevices = parsed.selectedDevices || [];
                
                // Apply saved settings to UI
                const strategySelect = document.getElementById('rotation-strategy-sidebar');
                const messagesInput = document.getElementById('messages-per-device-sidebar');
                const customCountDiv = document.getElementById('custom-count-settings-sidebar');
                
                if (strategySelect) {
                    strategySelect.value = this.rotationSettings.strategy;
                    // Update campaign settings
                    this.campaign.deviceRotation.strategy = this.rotationSettings.strategy;
                    // Show/hide custom count settings based on strategy
                    if (customCountDiv) {
                        customCountDiv.style.display = this.rotationSettings.strategy === 'custom-count' ? 'block' : 'none';
                    }
                }
                if (messagesInput) {
                    messagesInput.value = this.rotationSettings.messagesPerDevice;
                    this.campaign.deviceRotation.messagesPerDevice = this.rotationSettings.messagesPerDevice;
                }
                
                // Restore selected devices (will be applied when devices are loaded)
                if (this.rotationSettings.selectedDevices.length > 0) {
                    this.selectedDevices.clear();
                    this.rotationSettings.selectedDevices.forEach(deviceId => {
                        this.selectedDevices.add(deviceId);
                    });
                }
                
            } catch (e) {
                console.log('Failed to load rotation settings:', e);
            }
        }
    }

    saveRotationSettings() {
        try {
            const toSave = {
                strategy: this.rotationSettings.strategy,
                messagesPerDevice: this.rotationSettings.messagesPerDevice,
                selectedDevices: this.rotationSettings.selectedDevices
            };
            localStorage.setItem('whatsapp_rotation_settings', JSON.stringify(toSave));
            this.showToast('Success', 'Rotation settings saved!', 'success');
        } catch (e) {
            console.log('Failed to save rotation settings:', e);
        }
    }
}

// Global functions for HTML onclick handlers
window.whatsappSender = null;

document.addEventListener('DOMContentLoaded', () => {
    window.whatsappSender = new WhatsAppSenderPro();
});