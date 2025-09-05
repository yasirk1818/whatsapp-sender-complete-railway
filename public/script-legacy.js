// WhatsApp Sender Frontend JavaScript
class WhatsAppSender {
    constructor() {
        this.socket = null;
        this.sessionId = null;
        this.isSessionReady = false;
        this.connectionStatus = 'disconnected';
        
        // Initialize application
        this.init();
    }

    /**
     * Initialize the application
     */
    init() {
        console.log('Initializing WhatsApp Sender...');
        
        // Generate or retrieve session ID
        this.sessionId = this.generateSessionId();
        
        // Initialize Socket.io connection
        this.initSocket();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Update UI with session ID
        this.updateSessionDisplay();
        
        // Add initial activity log entry
        this.addActivityLog('info', 'Application initialized. Connecting to server...');
    }

    /**
     * Generate unique session ID
     */
    generateSessionId() {
        // Check if session ID exists in localStorage
        let sessionId = localStorage.getItem('whatsapp_session_id');
        
        if (!sessionId) {
            // Generate new session ID: visitor_{timestamp}_{randomString}
            const timestamp = Date.now();
            const randomString = Math.random().toString(36).substring(2, 8);
            sessionId = `visitor_${timestamp}_${randomString}`;
            
            // Store in localStorage
            localStorage.setItem('whatsapp_session_id', sessionId);
        }
        
        return sessionId;
    }

    /**
     * Initialize Socket.io connection
     */
    initSocket() {
        try {
            this.socket = io();
            
            // Connection event
            this.socket.on('connect', () => {
                console.log('Connected to server');
                this.updateConnectionStatus('connected');
                this.addActivityLog('success', 'Connected to server successfully');
                
                // Join session room
                this.joinSession();
            });

            // Disconnection event
            this.socket.on('disconnect', () => {
                console.log('Disconnected from server');
                this.updateConnectionStatus('disconnected');
                this.addActivityLog('error', 'Disconnected from server');
            });

            // QR Code event
            this.socket.on('qr-code', (data) => {
                console.log('QR Code received for session:', data.sessionId);
                this.displayQRCode(data.qrCode);
                this.addActivityLog('info', data.message || 'QR Code generated - Please scan with your mobile device');
            });

            // Session status event
            this.socket.on('session-status', (data) => {
                console.log('Session status update:', data);
                this.updateSessionStatus(data.status, data.isReady);
            });

            // Session ready event
            this.socket.on('session-ready', (data) => {
                console.log('Session ready:', data);
                this.isSessionReady = true;
                this.hideQRCode();
                this.updateSessionStatus('ready', true);
                this.enableMessageSending();
                this.addActivityLog('success', data.message || 'WhatsApp session is ready! You can now send messages.');
            });

            // Authentication failure event
            this.socket.on('auth-failure', (data) => {
                console.error('Authentication failed:', data);
                this.isSessionReady = false;
                this.updateSessionStatus('auth-failed', false);
                this.disableMessageSending();
                this.addActivityLog('error', data.message || 'Authentication failed. Please try again.');
            });

            // Session disconnected event
            this.socket.on('session-disconnected', (data) => {
                console.log('Session disconnected:', data);
                this.isSessionReady = false;
                this.hideQRCode();
                this.updateSessionStatus('disconnected', false);
                this.disableMessageSending();
                this.addActivityLog('warning', data.message || 'WhatsApp session disconnected');
            });

            // Session deleted event
            this.socket.on('session-deleted', (data) => {
                console.log('Session deleted:', data);
                this.isSessionReady = false;
                this.hideQRCode();
                this.updateSessionStatus('deleted', false);
                this.disableMessageSending();
                this.addActivityLog('info', data.message || 'Session deleted successfully');
                
                // Clear localStorage and generate new session ID
                localStorage.removeItem('whatsapp_session_id');
                setTimeout(() => {
                    location.reload();
                }, 2000);
            });

            // Message sent event
            this.socket.on('message-sent', (data) => {
                console.log('Message sent successfully:', data);
                this.addActivityLog('success', `Message sent successfully at ${new Date(data.timestamp).toLocaleTimeString()}`);
                this.showToast('Success', 'Message sent successfully!', 'success');
                
                // Clear form
                document.getElementById('message-form').reset();
                this.updateCharCount();
                this.removeFilePreview();
            });

            // Message error event
            this.socket.on('message-error', (data) => {
                console.error('Message sending failed:', data);
                this.addActivityLog('error', `Failed to send message: ${data.error}`);
                this.showToast('Error', `Failed to send message: ${data.error}`, 'error');
            });

            // Error event
            this.socket.on('error', (data) => {
                console.error('Socket error:', data);
                this.addActivityLog('error', `Error: ${data.message || data.error}`);
                this.showToast('Error', data.message || 'An error occurred', 'error');
            });

        } catch (error) {
            console.error('Socket initialization failed:', error);
            this.addActivityLog('error', 'Failed to connect to server');
        }
    }

    /**
     * Join session room
     */
    joinSession() {
        if (this.socket && this.sessionId) {
            console.log(`Joining session: ${this.sessionId}`);
            this.socket.emit('join-session', this.sessionId);
        }
    }

    /**
     * Set up event listeners
     */
    setupEventListeners() {
        // Message form submission
        const messageForm = document.getElementById('message-form');
        if (messageForm) {
            messageForm.addEventListener('submit', (e) => this.handleMessageSubmit(e));
        }

        // Character count for message textarea
        const messageText = document.getElementById('message-text');
        if (messageText) {
            messageText.addEventListener('input', () => this.updateCharCount());
        }

        // File input change
        const attachmentInput = document.getElementById('attachment');
        if (attachmentInput) {
            attachmentInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        // Remove file button
        const removeFileBtn = document.getElementById('remove-file');
        if (removeFileBtn) {
            removeFileBtn.addEventListener('click', () => this.removeFilePreview());
        }

        // Copy session ID button
        const copySessionBtn = document.getElementById('copy-session-btn');
        if (copySessionBtn) {
            copySessionBtn.addEventListener('click', () => this.copySessionId());
        }

        // Delete session button
        const deleteSessionBtn = document.getElementById('delete-session-btn');
        if (deleteSessionBtn) {
            deleteSessionBtn.addEventListener('click', () => this.confirmDeleteSession());
        }

        // Refresh session button
        const refreshSessionBtn = document.getElementById('refresh-session-btn');
        if (refreshSessionBtn) {
            refreshSessionBtn.addEventListener('click', () => this.refreshSessionStatus());
        }

        // Phone number formatting
        const phoneInput = document.getElementById('phone-number');
        if (phoneInput) {
            phoneInput.addEventListener('input', (e) => this.formatPhoneNumber(e));
        }
    }

    /**
     * Update session display in UI
     */
    updateSessionDisplay() {
        const sessionIdDisplay = document.getElementById('session-id-display');
        const sessionIdInput = document.getElementById('session-id-input');
        
        if (sessionIdDisplay) {
            sessionIdDisplay.textContent = this.sessionId;
        }
        
        if (sessionIdInput) {
            sessionIdInput.value = this.sessionId;
        }
    }

    /**
     * Update connection status indicator
     */
    updateConnectionStatus(status) {
        this.connectionStatus = status;
        const statusElement = document.getElementById('connection-status');
        
        if (statusElement) {
            const badge = statusElement.querySelector('.badge');
            
            switch (status) {
                case 'connected':
                    badge.className = 'badge bg-success';
                    badge.innerHTML = '<i class="fas fa-check-circle me-1"></i>Connected';
                    break;
                case 'connecting':
                    badge.className = 'badge bg-warning';
                    badge.innerHTML = '<i class="fas fa-circle-notch fa-spin me-1"></i>Connecting...';
                    break;
                case 'disconnected':
                    badge.className = 'badge bg-danger';
                    badge.innerHTML = '<i class="fas fa-times-circle me-1"></i>Disconnected';
                    break;
                default:
                    badge.className = 'badge bg-secondary';
                    badge.innerHTML = '<i class="fas fa-question-circle me-1"></i>Unknown';
            }
        }
    }

    /**
     * Update session status
     */
    updateSessionStatus(status, isReady) {
        this.isSessionReady = isReady;
        const statusElement = document.getElementById('session-status');
        const deleteBtn = document.getElementById('delete-session-btn');
        
        if (statusElement) {
            // Remove existing status classes
            statusElement.className = 'alert';
            
            let iconClass, message, alertClass;
            
            switch (status) {
                case 'initializing':
                    iconClass = 'fas fa-spinner fa-spin';
                    message = 'Initializing WhatsApp session...';
                    alertClass = 'alert-info status-connecting';
                    break;
                case 'waiting-for-qr-scan':
                    iconClass = 'fas fa-qrcode';
                    message = 'Waiting for QR code scan';
                    alertClass = 'alert-warning status-waiting';
                    break;
                case 'authenticated':
                    iconClass = 'fas fa-check-circle';
                    message = 'WhatsApp authenticated, getting ready...';
                    alertClass = 'alert-info status-connecting';
                    break;
                case 'ready':
                    iconClass = 'fas fa-check-circle';
                    message = 'WhatsApp session ready!';
                    alertClass = 'alert-success status-ready';
                    break;
                case 'auth-failed':
                    iconClass = 'fas fa-exclamation-triangle';
                    message = 'Authentication failed';
                    alertClass = 'alert-danger status-error';
                    break;
                case 'disconnected':
                    iconClass = 'fas fa-unlink';
                    message = 'WhatsApp session disconnected';
                    alertClass = 'alert-secondary status-disconnected';
                    break;
                case 'deleted':
                    iconClass = 'fas fa-trash';
                    message = 'Session deleted';
                    alertClass = 'alert-info status-disconnected';
                    break;
                default:
                    iconClass = 'fas fa-question-circle';
                    message = `Status: ${status}`;
                    alertClass = 'alert-secondary';
            }
            
            statusElement.className = `alert ${alertClass}`;
            statusElement.innerHTML = `<i class="${iconClass} me-2"></i>${message}`;
        }
        
        // Enable/disable delete button
        if (deleteBtn) {
            deleteBtn.disabled = (status === 'deleted' || status === 'not-found');
        }
        
        // Update message sending availability
        if (isReady) {
            this.enableMessageSending();
        } else {
            this.disableMessageSending();
        }
    }

    /**
     * Display QR code
     */
    displayQRCode(qrCodeDataUrl) {
        const qrSection = document.getElementById('qr-section');
        const qrContainer = document.getElementById('qr-code-container');
        
        if (qrSection && qrContainer) {
            qrContainer.innerHTML = `<img src="${qrCodeDataUrl}" alt="WhatsApp QR Code" class="img-fluid">`;
            qrSection.style.display = 'block';
        }
    }

    /**
     * Hide QR code
     */
    hideQRCode() {
        const qrSection = document.getElementById('qr-section');
        if (qrSection) {
            qrSection.style.display = 'none';
        }
    }

    /**
     * Enable message sending
     */
    enableMessageSending() {
        const sendBtn = document.getElementById('send-btn');
        if (sendBtn) {
            sendBtn.disabled = false;
        }
    }

    /**
     * Disable message sending
     */
    disableMessageSending() {
        const sendBtn = document.getElementById('send-btn');
        if (sendBtn) {
            sendBtn.disabled = true;
        }
    }

    /**
     * Handle message form submission
     */
    async handleMessageSubmit(event) {
        event.preventDefault();
        
        if (!this.isSessionReady) {
            this.showToast('Warning', 'WhatsApp session is not ready. Please wait for connection.', 'warning');
            return;
        }
        
        const formData = new FormData();
        const phoneNumber = document.getElementById('phone-number').value.trim();
        const messageText = document.getElementById('message-text').value.trim();
        const attachment = document.getElementById('attachment').files[0];
        
        // Validate inputs
        if (!phoneNumber || !messageText) {
            this.showToast('Error', 'Please fill in both phone number and message.', 'error');
            return;
        }
        
        // Prepare form data
        formData.append('sessionId', this.sessionId);
        formData.append('phoneNumber', phoneNumber);
        formData.append('message', messageText);
        
        if (attachment) {
            formData.append('attachment', attachment);
        }
        
        // Show loading state
        const sendBtn = document.getElementById('send-btn');
        const originalText = sendBtn.innerHTML;
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Sending...';
        sendBtn.disabled = true;
        
        try {
            this.addActivityLog('info', `Sending message to ${phoneNumber}...`);
            
            const response = await fetch('/send-message', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to send message');
            }
            
            // Success is handled by socket event
            
        } catch (error) {
            console.error('Error sending message:', error);
            this.addActivityLog('error', `Failed to send message: ${error.message}`);
            this.showToast('Error', `Failed to send message: ${error.message}`, 'error');
        } finally {
            // Restore button state
            sendBtn.innerHTML = originalText;
            sendBtn.disabled = !this.isSessionReady;
        }
    }

    /**
     * Update character count
     */
    updateCharCount() {
        const messageText = document.getElementById('message-text');
        const charCount = document.getElementById('char-count');
        
        if (messageText && charCount) {
            const count = messageText.value.length;
            charCount.textContent = count;
            
            // Change color based on length
            if (count > 1000) {
                charCount.style.color = '#dc3545';
            } else if (count > 800) {
                charCount.style.color = '#fd7e14';
            } else {
                charCount.style.color = '#495057';
            }
        }
    }

    /**
     * Handle file selection
     */
    handleFileSelect(event) {
        const file = event.target.files[0];
        const filePreview = document.getElementById('file-preview');
        const fileName = document.getElementById('file-name');
        
        if (file) {
            // Check file size (10MB limit)
            if (file.size > 10 * 1024 * 1024) {
                this.showToast('Error', 'File size must be less than 10MB', 'error');
                event.target.value = '';
                return;
            }
            
            // Show file preview
            if (filePreview && fileName) {
                fileName.textContent = `${file.name} (${this.formatFileSize(file.size)})`;
                filePreview.style.display = 'block';
            }
        } else {
            this.removeFilePreview();
        }
    }

    /**
     * Remove file preview
     */
    removeFilePreview() {
        const filePreview = document.getElementById('file-preview');
        const attachmentInput = document.getElementById('attachment');
        
        if (filePreview) {
            filePreview.style.display = 'none';
        }
        
        if (attachmentInput) {
            attachmentInput.value = '';
        }
    }

    /**
     * Format file size
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Copy session ID to clipboard
     */
    async copySessionId() {
        try {
            await navigator.clipboard.writeText(this.sessionId);
            this.showToast('Success', 'Session ID copied to clipboard!', 'success');
        } catch (error) {
            console.error('Failed to copy session ID:', error);
            
            // Fallback for older browsers
            const sessionIdInput = document.getElementById('session-id-input');
            if (sessionIdInput) {
                sessionIdInput.select();
                document.execCommand('copy');
                this.showToast('Success', 'Session ID copied to clipboard!', 'success');
            }
        }
    }

    /**
     * Confirm session deletion
     */
    confirmDeleteSession() {
        const modal = new bootstrap.Modal(document.getElementById('confirmModal'));
        const modalBody = document.getElementById('confirmModalBody');
        const confirmBtn = document.getElementById('confirmActionBtn');
        
        modalBody.innerHTML = `
            <p>Are you sure you want to delete this WhatsApp session?</p>
            <p><strong>Session ID:</strong> ${this.sessionId}</p>
            <p class="text-danger"><i class="fas fa-exclamation-triangle me-2"></i>This action cannot be undone. You will need to scan the QR code again to reconnect.</p>
        `;
        
        confirmBtn.onclick = () => {
            this.deleteSession();
            modal.hide();
        };
        
        modal.show();
    }

    /**
     * Delete session
     */
    deleteSession() {
        if (this.socket && this.sessionId) {
            this.socket.emit('delete-session', this.sessionId);
            this.addActivityLog('info', 'Deleting session...');
        }
    }

    /**
     * Refresh session status
     */
    refreshSessionStatus() {
        if (this.socket && this.sessionId) {
            this.socket.emit('get-session-status', this.sessionId);
            this.addActivityLog('info', 'Refreshing session status...');
        }
    }

    /**
     * Format phone number input
     */
    formatPhoneNumber(event) {
        let value = event.target.value.replace(/\D/g, ''); // Remove non-digits
        
        // Add + prefix if not present
        if (value && !value.startsWith('+')) {
            value = '+' + value;
        }
        
        event.target.value = value;
    }

    /**
     * Add activity log entry
     */
    addActivityLog(type, message) {
        const activityLog = document.getElementById('activity-log');
        if (!activityLog) return;
        
        const timestamp = new Date().toLocaleTimeString();
        const logItem = document.createElement('div');
        logItem.className = `activity-item ${type}`;
        
        let icon;
        switch (type) {
            case 'success':
                icon = 'fas fa-check-circle';
                break;
            case 'error':
                icon = 'fas fa-exclamation-circle';
                break;
            case 'warning':
                icon = 'fas fa-exclamation-triangle';
                break;
            case 'info':
            default:
                icon = 'fas fa-info-circle';
        }
        
        logItem.innerHTML = `
            <i class="${icon} me-2"></i>
            <span class="timestamp">[${timestamp}]</span>
            <span class="message">${message}</span>
        `;
        
        // Add to top of log
        activityLog.insertBefore(logItem, activityLog.firstChild);
        
        // Limit log entries (keep only last 50)
        const logItems = activityLog.querySelectorAll('.activity-item');
        if (logItems.length > 50) {
            for (let i = 50; i < logItems.length; i++) {
                logItems[i].remove();
            }
        }
    }

    /**
     * Show toast notification
     */
    showToast(title, message, type = 'info') {
        const toast = document.getElementById('toast');
        const toastTitle = document.getElementById('toast-title');
        const toastBody = document.getElementById('toast-body');
        const toastIcon = document.getElementById('toast-icon');
        
        if (toast && toastTitle && toastBody && toastIcon) {
            // Set content
            toastTitle.textContent = title;
            toastBody.textContent = message;
            
            // Set icon and color based on type
            let iconClass, bgClass;
            switch (type) {
                case 'success':
                    iconClass = 'fas fa-check-circle text-success';
                    bgClass = 'bg-success';
                    break;
                case 'error':
                    iconClass = 'fas fa-exclamation-circle text-danger';
                    bgClass = 'bg-danger';
                    break;
                case 'warning':
                    iconClass = 'fas fa-exclamation-triangle text-warning';
                    bgClass = 'bg-warning';
                    break;
                default:
                    iconClass = 'fas fa-info-circle text-info';
                    bgClass = 'bg-info';
            }
            
            toastIcon.className = iconClass;
            toast.querySelector('.toast-header').className = `toast-header ${bgClass} text-white`;
            
            // Show toast
            const bsToast = new bootstrap.Toast(toast);
            bsToast.show();
        }
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new WhatsAppSender();
    
    // Make app globally accessible for debugging
    window.whatsappSender = app;
    
    console.log('WhatsApp Sender application started');
});