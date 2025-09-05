// Bulk SMS Manager with Device Rotation
class BulkSMSManager {
    constructor() {
        this.socket = null;
        this.userId = this.generateUserId();
        this.devices = new Map();
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
                deviceUsageCount: new Map()
            }
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
        this.setupCSVTemplate();
    }



    initSocket() {
        this.socket = io();
        
        // Register this socket for global cleanup
        if (!window.socketManager) window.socketManager = this;
        
        this.socket.on('connect', () => {
            this.updateConnectionStatus('connected');
            this.socket.emit('identify-user', { userId: this.userId });
        });

        this.socket.on('disconnect', () => {
            this.updateConnectionStatus('disconnected');
        });

        this.socket.on('user-devices', (data) => {
            this.updateDevicesList(data.devices);
        });

        // Bulk messaging events
        this.socket.on('bulk-message-progress', (data) => {
            this.updateCampaignProgress(data);
        });

        this.socket.on('bulk-message-sent', (data) => {
            this.campaign.sent++;
            this.updateCampaignStats();
            this.updateDeviceUsage(data.deviceId);
        });

        this.socket.on('bulk-message-error', (data) => {
            this.campaign.failed++;
            this.updateCampaignStats();
        });

        this.socket.on('bulk-message-complete', (data) => {
            this.completeCampaign(data);
        });

        this.socket.on('error', (data) => {
            this.showToast('Error', data.message || 'An error occurred', 'error');
        });
    }

    setupEventListeners() {
        // Rotation strategy change
        document.getElementById('rotation-strategy')?.addEventListener('change', (e) => {
            this.handleRotationStrategyChange(e.target.value);
        });

        // Custom delay toggle
        document.getElementById('message-delay')?.addEventListener('change', (e) => {
            const customDelayDiv = document.getElementById('custom-delay');
            if (e.target.value === 'custom') {
                customDelayDiv.style.display = 'block';
            } else {
                customDelayDiv.style.display = 'none';
            }
        });

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
            document.getElementById('char-count').textContent = e.target.value.length;
            this.updateSendButtonState();
        });

        // Preview recipients (updated)
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

        // Refresh devices
        document.getElementById('refresh-devices-btn')?.addEventListener('click', () => {
            this.refreshDevices();
        });

        // Form submission
        document.getElementById('bulk-sms-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.startCampaign();
        });

        // Stop campaign
        document.getElementById('stop-campaign-btn')?.addEventListener('click', () => {
            this.stopCampaign();
        });
    }

    handleRotationStrategyChange(strategy) {
        this.campaign.deviceRotation.strategy = strategy;
        
        const manualSelection = document.getElementById('manual-device-selection');
        if (strategy === 'manual') {
            manualSelection.style.display = 'block';
            this.renderDeviceCheckboxes();
        } else {
            manualSelection.style.display = 'none';
            // Auto-select all ready devices for other strategies
            this.autoSelectDevices();
        }
        
        this.updateSelectedDevicesCount();
    }

    autoSelectDevices() {
        this.selectedDevices.clear();
        Array.from(this.devices.values())
            .filter(d => d.isReady)
            .forEach(d => this.selectedDevices.add(d.id));
    }

    switchInputMethod(method) {
        this.currentInputMethod = method;
        this.updateTotalRecipients();
    }
    
    updateManualCount() {
        const text = document.getElementById('manual-numbers-input')?.value || '';
        const lines = text.split('\n').filter(line => line.trim());
        document.getElementById('manual-count').textContent = lines.length;
    }
    
    parseManualNumbers() {
        const text = document.getElementById('manual-numbers-input')?.value || '';
        const lines = text.split('\n').filter(line => line.trim());
        
        this.manualRecipients = [];
        const phoneRegex = /^\+?[1-9]\d{1,14}$/;
        
        for (const line of lines) {
            const parts = line.trim().split(',').map(part => part.trim());
            const phoneNumber = parts[0];
            
            if (phoneNumber && phoneRegex.test(phoneNumber.replace(/\D/g, ''))) {
                const cleanPhone = phoneNumber.replace(/\D/g, '');
                const name = parts[1] || cleanPhone;
                const city = parts[2] || '';
                const order = parts[3] || '';
                
                this.manualRecipients.push({
                    phoneNumber: cleanPhone,
                    name: name,
                    city: city,
                    order: order
                });
            }
        }
        
        document.getElementById('manual-parsed-count').textContent = this.manualRecipients.length;
        
        if (this.manualRecipients.length > 0) {
            document.getElementById('manual-preview').style.display = 'block';
            this.showToast('Success', `${this.manualRecipients.length} valid contacts parsed!`, 'success');
        } else {
            document.getElementById('manual-preview').style.display = 'none';
            this.showToast('Warning', 'No valid phone numbers found!', 'warning');
        }
        
        this.updateTotalRecipients();
    }
    
    clearManualNumbers() {
        if (confirm('Are you sure you want to clear all manually entered numbers?')) {
            document.getElementById('manual-numbers-input').value = '';
            this.manualRecipients = [];
            document.getElementById('manual-count').textContent = '0';
            document.getElementById('manual-parsed-count').textContent = '0';
            document.getElementById('manual-preview').style.display = 'none';
            this.updateTotalRecipients();
        }
    }
    
    clearAllRecipients() {
        if (confirm('Are you sure you want to clear all recipients from both manual input and CSV?')) {
            // Clear manual input
            document.getElementById('manual-numbers-input').value = '';
            this.manualRecipients = [];
            document.getElementById('manual-count').textContent = '0';
            document.getElementById('manual-parsed-count').textContent = '0';
            document.getElementById('manual-preview').style.display = 'none';
            
            // Clear CSV
            document.getElementById('csv-file').value = '';
            this.csvRecipients = [];
            document.getElementById('csv-count').textContent = '0';
            document.getElementById('csv-preview').style.display = 'none';
            
            this.updateTotalRecipients();
            this.showToast('Info', 'All recipients cleared!', 'info');
        }
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
        document.getElementById('total-recipients-count').textContent = totalCount;
        
        if (totalCount > 0) {
            document.getElementById('recipients-summary').style.display = 'block';
        } else {
            document.getElementById('recipients-summary').style.display = 'none';
        }
        
        this.updateSendButtonState();
    }
    
    showManualRecipientsPreview() {
        this.showRecipientsPreview('manual');
    }
    
    renderDeviceCheckboxes() {
        const container = document.getElementById('device-checkboxes');
        const readyDevices = Array.from(this.devices.values()).filter(d => d.isReady);
        
        if (readyDevices.length === 0) {
            container.innerHTML = '<div class="text-muted">No ready devices available</div>';
            return;
        }
        
        container.innerHTML = readyDevices.map(device => `
            <div class="form-check">
                <input class="form-check-input device-checkbox" type="checkbox" 
                       value="${device.id}" id="device-${device.id}"
                       ${this.selectedDevices.has(device.id) ? 'checked' : ''}>
                <label class="form-check-label" for="device-${device.id}">
                    ${device.name} ${device.phoneNumber ? `(${device.phoneNumber})` : ''}
                </label>
            </div>
        `).join('');
        
        // Add event listeners for checkboxes
        container.querySelectorAll('.device-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.selectedDevices.add(e.target.value);
                } else {
                    this.selectedDevices.delete(e.target.value);
                }
                this.updateSelectedDevicesCount();
                this.updateSendButtonState();
            });
        });
    }

    updateDevicesList(devices) {
        this.devices.clear();
        devices.forEach(device => this.devices.set(device.id, device));
        
        const readyDevices = devices.filter(d => d.isReady);
        
        // Update counts
        document.getElementById('ready-devices-count').textContent = readyDevices.length;
        document.getElementById('total-ready-devices').textContent = readyDevices.length;
        
        // Auto-select devices if not manual strategy
        const strategy = document.getElementById('rotation-strategy').value;
        if (strategy !== 'manual') {
            this.autoSelectDevices();
        } else {
            this.renderDeviceCheckboxes();
        }
        
        this.updateSelectedDevicesCount();
        this.updateSendButtonState();
    }

    updateSelectedDevicesCount() {
        document.getElementById('selected-devices-count').textContent = this.selectedDevices.size;
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

    async startCampaign() {
        // Validate form
        if (!this.validateCampaignForm()) return;
        
        console.log('Starting campaign with recipients:', this.recipients.length);
        console.log('Selected devices:', Array.from(this.selectedDevices));
        
        const formData = new FormData();
        const messageTemplate = document.getElementById('message-template').value;
        const campaignName = document.getElementById('campaign-name').value || `Campaign-${Date.now()}`;
        const delay = this.getMessageDelay();
        
        // Prepare CSV data for selected devices strategy
        const csvContent = this.generateCSVFromRecipients();
        const csvBlob = new Blob([csvContent], { type: 'text/csv' });
        
        formData.append('userId', this.userId);
        formData.append('message', messageTemplate);
        formData.append('delay', delay);
        formData.append('csvFile', csvBlob, 'recipients.csv');
        formData.append('rotationStrategy', this.campaign.deviceRotation.strategy);
        formData.append('selectedDevices', JSON.stringify(Array.from(this.selectedDevices)));
        
        const attachment = document.getElementById('bulk-attachment').files[0];
        if (attachment) {
            formData.append('attachment', attachment);
        }
        
        console.log('Form data prepared:', {
            userId: this.userId,
            messageLength: messageTemplate.length,
            recipientsCount: this.recipients.length,
            csvBlobSize: csvBlob.size,
            selectedDevicesCount: this.selectedDevices.size,
            attachmentName: attachment ? attachment.name : 'none'
        });
        
        try {
            // Initialize campaign
            this.campaign.isActive = true;
            this.campaign.name = campaignName;
            this.campaign.total = this.recipients.length;
            this.campaign.sent = 0;
            this.campaign.failed = 0;
            this.campaign.currentIndex = 0;
            this.campaign.deviceRotation.currentDeviceIndex = 0;
            this.campaign.deviceRotation.deviceUsageCount.clear();
            
            // Show progress section
            document.getElementById('campaign-name-display').textContent = campaignName;
            document.getElementById('campaign-progress').style.display = 'block';
            this.updateCampaignStats();
            this.initDeviceRotationDisplay();
            
            // Start campaign
            const response = await fetch('/send-bulk-messages', {
                method: 'POST',
                body: formData
            });
            
            // Check if response is OK
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server error response:', errorText);
                throw new Error(`Server error (${response.status}): ${response.statusText}`);
            }
            
            // Check if response is JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const htmlResponse = await response.text();
                console.error('Non-JSON response received:', htmlResponse.substring(0, 200));
                throw new Error('Server returned HTML instead of JSON. Check server logs for errors.');
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Unknown server error');
            }
            
            this.showToast('Success', `Campaign "${campaignName}" started with ${result.recipients} recipients!`, 'success');
            
        } catch (error) {
            console.error('Campaign start error:', error);
            
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
            this.campaign.isActive = false;
            document.getElementById('campaign-progress').style.display = 'none';
        }
    }

    validateCampaignForm() {
        // Check if we have recipients from either source
        const totalRecipients = this.recipients.length;
        
        if (totalRecipients === 0) {
            this.showToast('Error', 'Please add recipients using manual input or CSV upload', 'error');
            return false;
        }
        
        if (this.selectedDevices.size === 0) {
            this.showToast('Error', 'No ready devices available for sending messages', 'error');
            return false;
        }
        
        const messageTemplate = document.getElementById('message-template').value.trim();
        if (!messageTemplate) {
            this.showToast('Error', 'Please enter a message template', 'error');
            return false;
        }
        
        return true;
    }

    getMessageDelay() {
        const delaySelect = document.getElementById('message-delay');
        if (delaySelect.value === 'custom') {
            const customDelay = parseInt(document.getElementById('custom-delay-input').value);
            return customDelay && customDelay >= 500 ? customDelay : 2000;
        }
        return parseInt(delaySelect.value);
    }

    generateCSVFromRecipients() {
        if (this.recipients.length === 0) {
            return 'phone,name,city,order\n'; // Empty CSV with headers
        }
        
        const csvContent = 'phone,name,city,order\n' + 
            this.recipients.map(r => `${r.phoneNumber},${r.name},${r.city || ''},${r.order || ''}`).join('\n');
        console.log('Generated CSV content:', csvContent.substring(0, 200) + '...');
        return csvContent;
    }

    updateCampaignProgress(data) {
        this.campaign.currentIndex = data.current;
        
        const percentage = Math.round((data.current / data.total) * 100);
        document.getElementById('progress-percentage').textContent = `${percentage}%`;
        document.getElementById('progress-bar').style.width = `${percentage}%`;
        document.getElementById('current-recipient').textContent = data.recipient;
        document.getElementById('current-device').textContent = this.getDeviceName(data.deviceId);
        
        this.updateCampaignStats();
    }

    updateCampaignStats() {
        document.getElementById('total-messages').textContent = this.campaign.total;
        document.getElementById('sent-messages').textContent = this.campaign.sent;
        document.getElementById('failed-messages').textContent = this.campaign.failed;
        document.getElementById('remaining-messages').textContent = 
            this.campaign.total - this.campaign.sent - this.campaign.failed;
    }

    updateDeviceUsage(deviceId) {
        const count = (this.campaign.deviceRotation.deviceUsageCount.get(deviceId) || 0) + 1;
        this.campaign.deviceRotation.deviceUsageCount.set(deviceId, count);
        this.updateDeviceRotationDisplay();
    }

    initDeviceRotationDisplay() {
        const container = document.getElementById('device-rotation-status');
        const selectedDevicesList = Array.from(this.selectedDevices)
            .map(id => this.devices.get(id))
            .filter(Boolean);
        
        container.innerHTML = selectedDevicesList.map(device => `
            <div class="col-md-4 col-sm-6 mb-2">
                <div class="card bg-light">
                    <div class="card-body p-2 text-center">
                        <div class="fw-bold">${device.name}</div>
                        <div class="text-muted small">${device.phoneNumber}</div>
                        <div class="badge bg-primary" id="device-usage-${device.id}">0 sent</div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    updateDeviceRotationDisplay() {
        this.campaign.deviceRotation.deviceUsageCount.forEach((count, deviceId) => {
            const element = document.getElementById(`device-usage-${deviceId}`);
            if (element) {
                element.textContent = `${count} sent`;
                element.className = count > 0 ? 'badge bg-success' : 'badge bg-primary';
            }
        });
    }

    completeCampaign(data) {
        this.campaign.isActive = false;
        this.campaign.sent = data.successful;
        this.campaign.failed = data.failed;
        
        this.updateCampaignStats();
        
        // Update progress bar to 100%
        document.getElementById('progress-percentage').textContent = '100%';
        document.getElementById('progress-bar').style.width = '100%';
        document.getElementById('current-recipient').textContent = 'Campaign Complete';
        document.getElementById('current-device').textContent = '-';
        
        this.showToast('Success', 
            `Campaign completed! ${data.successful} sent, ${data.failed} failed`, 'success');
    }

    stopCampaign() {
        if (confirm('Are you sure you want to stop the current campaign?')) {
            this.campaign.isActive = false;
            document.getElementById('campaign-progress').style.display = 'none';
            this.showToast('Info', 'Campaign stopped by user', 'info');
        }
    }

    getDeviceName(deviceId) {
        const device = this.devices.get(deviceId);
        return device ? device.name : 'Unknown Device';
    }

    updateSendButtonState() {
        const sendBtn = document.getElementById('start-campaign-btn');
        const hasRecipients = this.recipients.length > 0;
        const hasMessage = document.getElementById('message-template')?.value.trim();
        const hasDevices = this.selectedDevices.size > 0;
        
        sendBtn.disabled = !(hasRecipients && hasMessage && hasDevices && !this.campaign.isActive);
        
        // Update button text to show recipient count
        if (hasRecipients) {
            sendBtn.innerHTML = `
                <i class="fas fa-rocket me-2"></i>
                Start Campaign (${this.recipients.length} recipients)
            `;
        } else {
            sendBtn.innerHTML = `
                <i class="fas fa-rocket me-2"></i>
                Start Bulk SMS Campaign
            `;
        }
    }

    // Add disconnect method for cleanup
    disconnect() {
        if (this.socket && this.socket.connected) {
            console.log('Disconnecting socket for cleanup (bulk-sms)');
            this.socket.disconnect();
        }
    }

    // Utility methods
    updateUserDisplay() {
        // Simply display the user ID since we're not using authentication
        const userDisplay = document.getElementById('user-display-name');
        if (userDisplay) {
            userDisplay.textContent = this.userId || 'User';
        }
    }

    updateConnectionStatus(status) {
        const badge = document.querySelector('#connection-status .badge');
        if (!badge) return;
        
        if (status === 'connected') {
            badge.className = 'badge bg-success';
            badge.innerHTML = '<i class="fas fa-check-circle me-1"></i>Connected';
        } else {
            badge.className = 'badge bg-danger';
            badge.innerHTML = '<i class="fas fa-times-circle me-1"></i>Disconnected';
        }
    }

    refreshDevices() {
        if (this.socket) {
            this.socket.emit('identify-user', { userId: this.userId });
        }
    }

    setupCSVTemplate() {
        document.getElementById('download-csv-template')?.addEventListener('click', (e) => {
            e.preventDefault();
            const csv = "phone,name,city,order\n+1234567890,John Doe,New York,ORD001\n+9876543210,Jane Smith,London,ORD002\n+1122334455,Mike Johnson,Paris,ORD003";
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'whatsapp_bulk_sms_template.csv';
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('Success', 'CSV template downloaded!', 'success');
        });
    }

    showToast(title, message, type = 'info') {
        const toast = document.getElementById('toast');
        const toastTitle = document.getElementById('toast-title');
        const toastBody = document.getElementById('toast-body');
        const toastIcon = document.getElementById('toast-icon');
        
        if (toast && toastTitle && toastBody && toastIcon) {
            toastTitle.textContent = title;
            toastBody.textContent = message;
            
            const iconClass = {
                'success': 'fas fa-check-circle text-success',
                'error': 'fas fa-exclamation-circle text-danger',
                'warning': 'fas fa-exclamation-triangle text-warning',
                'info': 'fas fa-info-circle text-info'
            }[type] || 'fas fa-info-circle text-info';
            
            toastIcon.className = iconClass;
            new bootstrap.Toast(toast).show();
        }
    }
}

// Global instance
window.bulkSMSManager = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.bulkSMSManager = new BulkSMSManager();
});