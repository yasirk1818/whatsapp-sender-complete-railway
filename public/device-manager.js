// Device Management Page JavaScript
class DeviceManagerPage {
    constructor() {
        this.socket = null;
        this.userId = this.generateUserId();
        this.devices = new Map();
        this.pendingQRDevices = new Map();
        this.isDeviceCreationInProgress = false;
        this.devicesBeingCreated = 0;
        this.devicesCreatedCount = 0;
        this.totalDevicesToCreate = 0;
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
    }



    initSocket() {
        this.socket = io();
        
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

        this.socket.on('device-created', (data) => {
            console.log('Device created:', data.device.name);
            this.showToast('Success', `Device "${data.device.name}" created successfully!`, 'success');
            
            // Hide inline loading immediately when any device is created
            if (this.isDeviceCreationInProgress) {
                console.log('Device created, hiding inline loading immediately');
                this.resetDeviceCreationState();
            }
            
            // Refresh devices list to show the new device immediately
            this.refreshDevices();
        });

        this.socket.on('device-qr-code', (data) => {
            console.log('QR code received for device:', data.deviceId);
            this.handleDeviceQRCode(data);
        });

        this.socket.on('device-ready', (data) => {
            this.showToast('Success', `Device connected! Phone: ${data.phoneNumber}`, 'success');
            
            // Remove from pending QR codes
            this.pendingQRDevices.delete(data.deviceId);
            
            // Close any open QR modals for this device
            const qrModal = document.getElementById('singleQRModal');
            const qrCodeModal = document.getElementById('qrCodeModal');
            
            if (qrModal) {
                const bootstrapModal = bootstrap.Modal.getInstance(qrModal);
                if (bootstrapModal) {
                    bootstrapModal.hide();
                }
            }
            
            if (qrCodeModal) {
                const bootstrapModal = bootstrap.Modal.getInstance(qrCodeModal);
                if (bootstrapModal) {
                    bootstrapModal.hide();
                }
            }
            
            // Hide QR codes section if no more pending QR codes
            this.updateQRDisplay();
            
            // Refresh the page to show updated device status
            setTimeout(() => {
                this.refreshDevices();
            }, 1000);
        });

        this.socket.on('device-deleted', (data) => {
            this.showToast('Success', 'Device deleted successfully', 'success');
            this.refreshDevices();
        });

        this.socket.on('device-status', (data) => {
            this.updateDeviceStatus(data);
        });

        this.socket.on('error', (data) => {
            // Improved error handling - only show relevant errors
            console.error('Socket error:', data);
            
            if (data.message && 
                !data.message.includes('successfully') && 
                !data.message.includes('completed') && 
                !data.message.includes('ready')) {
                
                this.showToast('Error', data.message || 'An error occurred', 'error');
                
                // Hide inline loading if error occurs during device creation
                if (this.isDeviceCreationInProgress) {
                    this.hideInlineLoadingMessage();
                    this.isDeviceCreationInProgress = false;
                }
            }
        });
    }

    setupEventListeners() {
        // Bulk add devices
        document.getElementById('bulk-add-devices-btn')?.addEventListener('click', () => {
            this.bulkAddDevices();
        });

        // Refresh all devices
        document.getElementById('refresh-all-btn')?.addEventListener('click', () => {
            this.refreshDevices();
        });

        // Delete all devices
        document.getElementById('delete-all-btn')?.addEventListener('click', () => {
            this.confirmDeleteAllDevices();
        });
        
        // Prevent navigation during device creation
        window.addEventListener('beforeunload', (e) => {
            if (this.isDeviceCreationInProgress) {
                e.preventDefault();
                e.returnValue = 'Device creation is in progress. Are you sure you want to leave?';
                return e.returnValue;
            }
        });
        
        // Block navigation links during device creation
        document.querySelectorAll('nav a.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                if (this.isDeviceCreationInProgress) {
                    e.preventDefault();
                    this.showToast('Warning', 'Please wait for device creation to complete', 'warning');
                }
            });
        });
    }

    async bulkAddDevices() {
        if (this.isDeviceCreationInProgress) {
            this.showToast('Warning', 'Device creation already in progress, please wait...', 'warning');
            return;
        }

        const count = parseInt(document.getElementById('bulk-device-count').value);
        const prefix = document.getElementById('device-name-prefix').value.trim() || 'WhatsApp-Device';
        
        // Initialize creation state
        this.isDeviceCreationInProgress = true;
        this.devicesBeingCreated = count;
        this.devicesCreatedCount = 0;
        this.totalDevicesToCreate = count;
        
        // Show inline loading message instead of full-screen overlay
        this.showInlineLoadingMessage(`Please wait, adding ${count} device(s)...`);
        
        // Disable form controls
        this.disableDeviceControls(true);
        
        try {
            console.log(`Starting creation of ${count} devices with prefix: ${prefix}`);
            
            // Create devices sequentially to avoid overwhelming the system
            for (let i = 1; i <= count; i++) {
                const deviceName = `${prefix}-${i}`;
                
                try {
                    // Update inline loading message
                    this.updateInlineLoadingMessage(`Please wait, adding device ${i} of ${count} (${deviceName})...`);
                    
                    await this.createSingleDevice(deviceName, i, count);
                    console.log(`Device ${i} (${deviceName}) created successfully`);
                    
                    // Hide loading after first successful device (if still in progress)
                    if (i === 1 && this.isDeviceCreationInProgress) {
                        console.log('First device created, hiding loading...');
                        setTimeout(() => {
                            if (this.isDeviceCreationInProgress) {
                                this.resetDeviceCreationState();
                            }
                        }, 1000); // Small delay to show success
                    }
                    
                    // Small delay between devices
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                } catch (error) {
                    console.error(`Error creating device ${deviceName}:`, error);
                    this.showToast('Error', `Failed to create device ${deviceName}`, 'error');
                }
            }
            
            this.showToast('Success', `Device creation process completed!`, 'success');
            
        } catch (error) {
            console.error('Bulk device creation error:', error);
            this.showToast('Error', 'Failed to create devices: ' + error.message, 'error');
        } finally {
            // Ensure UI state is always restored
            if (this.isDeviceCreationInProgress) {
                this.resetDeviceCreationState();
            }
            
            // Refresh devices list
            setTimeout(() => {
                this.refreshDevices();
            }, 1000);
        }
    }
    
    async createSingleDevice(deviceName, currentIndex, totalCount) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Timeout creating device ${deviceName}`));
            }, 15000); // 15 second timeout per device
            
            // Update inline loading message
            this.updateInlineLoadingMessage(`Please wait, adding device ${currentIndex} of ${totalCount} (${deviceName})...`);
            
            const onCreated = (data) => {
                if (data.device && data.device.name === deviceName) {
                    clearTimeout(timeout);
                    this.socket.off('device-created', onCreated);
                    this.socket.off('error', onError);
                    resolve(data);
                }
            };
            
            const onError = (error) => {
                if (error.message && error.message.includes(deviceName)) {
                    clearTimeout(timeout);
                    this.socket.off('device-created', onCreated);
                    this.socket.off('error', onError);
                    reject(new Error(error.message));
                }
            };
            
            this.socket.on('device-created', onCreated);
            this.socket.on('error', onError);
            
            // Emit device creation request
            this.socket.emit('create-device', { deviceName });
        });
    }

    handleDeviceQRCode(data) {
        console.log('QR code received for device:', data.deviceId);
        
        // Store QR code data and show success message
        this.pendingQRDevices.set(data.deviceId, {
            deviceId: data.deviceId,
            qrCode: data.qrCode,
            deviceName: this.getDeviceName(data.deviceId),
            timestamp: data.timestamp || new Date()
        });
        
        // Refresh devices list to update button states (enable Get QR button)
        this.refreshDevices();
        
        // Show success message that QR is ready
        this.showToast('Success', `QR code ready for ${this.getDeviceName(data.deviceId)}! Click "Get QR" to view`, 'success');
        
        // Auto-show QR code for better user experience
        this.showSingleQRCode(this.pendingQRDevices.get(data.deviceId));
    }

    getDeviceName(deviceId) {
        const device = this.devices.get(deviceId);
        return device ? device.name : `Device-${deviceId.substring(0, 8)}`;
    }

    updateQRDisplay() {
        // This function manages the QR codes section visibility
        // QR codes are NEVER automatically displayed
        const container = document.getElementById('qr-codes-container');
        const sectionContainer = document.getElementById('qr-codes-section');
        
        // Always hide the QR section by default
        if (sectionContainer) {
            sectionContainer.style.display = 'none';
        }
        
        // Clear container
        if (container) {
            container.innerHTML = '';
        }
        
        // QR codes will only be shown when user explicitly clicks "Get QR" button
        // This function no longer automatically displays QR codes
    }

    createQRCard(qrData) {
        const col = document.createElement('div');
        col.className = 'col-md-4 col-lg-3 mb-3';
        
        col.innerHTML = `
            <div class="card h-100">
                <div class="card-header text-center bg-warning text-dark">
                    <h6 class="mb-0">${qrData.deviceName}</h6>
                </div>
                <div class="card-body text-center p-2">
                    <img src="${qrData.qrCode}" class="img-fluid" style="max-width: 150px; width: 100%;">
                    <div class="mt-2">
                        <small class="text-muted">Scan with WhatsApp</small>
                        <div class="spinner-border spinner-border-sm text-warning mt-1" role="status">
                            <span class="visually-hidden">Waiting...</span>
                        </div>
                    </div>
                </div>
                <div class="card-footer p-2">
                    <button class="btn btn-danger btn-sm w-100" onclick="deviceManager.deleteDevice('${qrData.deviceId}')">
                        <i class="fas fa-trash me-1"></i>Cancel
                    </button>
                </div>
            </div>
        `;
        
        return col;
    }

    showSingleQRCode(qrData) {
        console.log('Showing single QR code for:', qrData.deviceName);
        
        // Create or get existing modal
        let modal = document.getElementById('singleQRModal');
        if (!modal) {
            modal = this.createSingleQRModal();
        }
        
        // Update modal content
        const modalTitle = modal.querySelector('.modal-title');
        const modalBody = modal.querySelector('.modal-body');
        
        modalTitle.innerHTML = `<i class="fas fa-qrcode me-2"></i>QR Code - ${qrData.deviceName}`;
        
        modalBody.innerHTML = `
            <div class="text-center">
                <img src="${qrData.qrCode}" class="img-fluid" style="max-width: 300px; width: 100%;">
                <div class="mt-3">
                    <p class="text-muted mb-1">Scan this QR code with WhatsApp on your phone</p>
                    <div class="spinner-border spinner-border-sm text-primary" role="status">
                        <span class="visually-hidden">Waiting for scan...</span>
                    </div>
                </div>
            </div>
        `;
        
        // Store reference to modal for later closure
        modal.setAttribute('data-device-id', qrData.deviceId);
        
        // Show modal
        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }
    
    createSingleQRModal() {
        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = 'singleQRModal';
        modal.tabIndex = -1;
        
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">QR Code</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <!-- QR code content will be inserted here -->
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            <i class="fas fa-times me-1"></i>Close
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        return modal;
    }
    
    showQRCodesSection() {
        document.getElementById('qr-codes-section').style.display = 'block';
    }

    updateDevicesList(devices) {
        this.devices.clear();
        devices.forEach(device => this.devices.set(device.id, device));
        
        this.updateDeviceStatistics(devices);
        this.renderDevicesList(devices);
    }

    updateDeviceStatistics(devices) {
        const ready = devices.filter(d => d.isReady).length;
        const scanning = devices.filter(d => d.status === 'waiting-for-qr-scan').length;
        const disconnected = devices.filter(d => d.status === 'disconnected').length;
        const total = devices.length;
        
        document.getElementById('ready-devices-count').textContent = ready;
        document.getElementById('scanning-devices-count').textContent = scanning;
        document.getElementById('disconnected-devices-count').textContent = disconnected;
        document.getElementById('total-devices-count').textContent = total;
    }

    renderDevicesList(devices) {
        const container = document.getElementById('devices-list-container');
        
        if (devices.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center p-5">
                    <i class="fas fa-mobile-alt fa-4x mb-3"></i>
                    <h4>No Devices Yet</h4>
                    <p>Click "Add Devices" above to start adding WhatsApp devices to your account.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = `
            <div class="row">
                ${devices.map(device => this.createDeviceCard(device)).join('')}
            </div>
        `;
    }

    createDeviceCard(device) {
        const statusConfig = this.getStatusConfig(device);
        const hasQRCode = this.pendingQRDevices.has(device.id);
        
        return `
            <div class="col-md-6 col-lg-4 mb-3">
                <div class="card h-100 border-${statusConfig.color}">
                    <div class="card-header bg-${statusConfig.color} text-white">
                        <div class="d-flex justify-content-between align-items-center">
                            <h6 class="mb-0">${device.name}</h6>
                            <div class="dropdown">
                                <button class="btn btn-sm btn-outline-light dropdown-toggle" data-bs-toggle="dropdown">
                                    <i class="fas fa-ellipsis-v"></i>
                                </button>
                                <ul class="dropdown-menu">
                                    <li><a class="dropdown-item" onclick="deviceManager.showDeviceDetails('${device.id}')">
                                        <i class="fas fa-info-circle me-2"></i>Details
                                    </a></li>
                                    <li><a class="dropdown-item" onclick="deviceManager.refreshDevice('${device.id}')">
                                        <i class="fas fa-sync-alt me-2"></i>Refresh
                                    </a></li>
                                    <li><hr class="dropdown-divider"></li>
                                    <li><a class="dropdown-item text-danger" onclick="deviceManager.confirmDeleteDevice('${device.id}', '${device.name}')">
                                        <i class="fas fa-trash me-2"></i>Delete
                                    </a></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="d-flex align-items-center mb-2">
                            <i class="fas fa-${statusConfig.icon} me-2"></i>
                            <span class="fw-bold">${statusConfig.text}</span>
                        </div>
                        ${device.phoneNumber ? `<div class="mb-2"><i class="fas fa-phone me-2"></i>${device.phoneNumber}</div>` : ''}
                        <div class="mb-2">
                            <small class="text-muted">
                                <i class="fas fa-calendar me-1"></i>
                                Created: ${new Date(device.createdAt).toLocaleDateString()}
                            </small>
                        </div>
                        <div class="mb-2">
                            <small class="text-muted">
                                <i class="fas fa-clock me-1"></i>
                                Last Activity: ${new Date(device.lastActivity).toLocaleString()}
                            </small>
                        </div>
                    </div>
                    <div class="card-footer p-2">
                        <div class="row g-1">
                            ${!device.isReady ? `
                                <div class="col-6">
                                    <button class="btn btn-warning btn-sm w-100" 
                                            onclick="deviceManager.getQRCode('${device.id}')" 
                                            ${!hasQRCode ? 'disabled' : ''} 
                                            id="qr-btn-${device.id}">
                                        <i class="fas fa-qrcode me-1"></i>
                                        ${hasQRCode ? 'Get QR' : 'QR Pending...'}
                                    </button>
                                </div>
                                <div class="col-6">
                                    <button class="btn btn-danger btn-sm w-100" 
                                            onclick="deviceManager.confirmDeleteDevice('${device.id}', '${device.name}')">
                                        <i class="fas fa-trash me-1"></i>Delete
                                    </button>
                                </div>
                            ` : `
                                <div class="col-12">
                                    <span class="badge bg-success w-100 p-2">
                                        <i class="fas fa-check-circle me-1"></i>Ready for Messaging
                                    </span>
                                </div>
                                <div class="col-12 mt-1">
                                    <button class="btn btn-danger btn-sm w-100" 
                                            onclick="deviceManager.confirmDeleteDevice('${device.id}', '${device.name}')">
                                        <i class="fas fa-trash me-1"></i>Delete Device
                                    </button>
                                </div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    getStatusConfig(device) {
        if (device.isReady) {
            return { color: 'success', icon: 'check-circle', text: 'Connected & Ready' };
        } else if (device.status === 'waiting-for-qr-scan') {
            return { color: 'warning', icon: 'qrcode', text: 'Waiting for QR Scan' };
        } else if (device.status === 'authenticated') {
            return { color: 'info', icon: 'spinner fa-spin', text: 'Authenticating...' };
        } else {
            return { color: 'secondary', icon: 'times-circle', text: 'Disconnected' };
        }
    }

    showDeviceDetails(deviceId) {
        const device = this.devices.get(deviceId);
        if (!device) return;
        
        const modal = new bootstrap.Modal(document.getElementById('deviceDetailsModal'));
        const content = document.getElementById('device-details-content');
        
        content.innerHTML = `
            <div class="row">
                <div class="col-md-6 mb-3">
                    <label class="form-label fw-bold">Device Name:</label>
                    <div class="form-control-plaintext">${device.name}</div>
                </div>
                <div class="col-md-6 mb-3">
                    <label class="form-label fw-bold">Device ID:</label>
                    <div class="form-control-plaintext"><code>${device.id}</code></div>
                </div>
                <div class="col-md-6 mb-3">
                    <label class="form-label fw-bold">Status:</label>
                    <div class="form-control-plaintext">
                        <span class="badge bg-${this.getStatusConfig(device).color}">
                            ${this.getStatusConfig(device).text}
                        </span>
                    </div>
                </div>
                <div class="col-md-6 mb-3">
                    <label class="form-label fw-bold">Phone Number:</label>
                    <div class="form-control-plaintext">${device.phoneNumber || 'Not available'}</div>
                </div>
                <div class="col-md-6 mb-3">
                    <label class="form-label fw-bold">Created At:</label>
                    <div class="form-control-plaintext">${new Date(device.createdAt).toLocaleString()}</div>
                </div>
                <div class="col-md-6 mb-3">
                    <label class="form-label fw-bold">Last Activity:</label>
                    <div class="form-control-plaintext">${new Date(device.lastActivity).toLocaleString()}</div>
                </div>
            </div>
        `;
        
        document.getElementById('delete-device-modal-btn').onclick = () => {
            this.deleteDevice(deviceId);
            modal.hide();
        };
        
        modal.show();
    }

    confirmDeleteDevice(deviceId, deviceName) {
        if (confirm(`Are you sure you want to delete device "${deviceName}"?\n\nThis action cannot be undone.`)) {
            this.deleteDevice(deviceId);
        }
    }

    deleteDevice(deviceId) {
        if (this.socket) {
            this.socket.emit('delete-device', { deviceId });
            
            // Also remove from pending QR codes
            this.pendingQRDevices.delete(deviceId);
            this.updateQRDisplay();
        }
    }

    confirmDeleteAllDevices() {
        const deviceCount = this.devices.size;
        if (deviceCount === 0) {
            this.showToast('Info', 'No devices to delete', 'info');
            return;
        }
        
        if (confirm(`Are you sure you want to delete all ${deviceCount} devices?\n\nThis action cannot be undone and will disconnect all WhatsApp sessions.`)) {
            this.deleteAllDevices();
        }
    }

    deleteAllDevices() {
        const deviceIds = Array.from(this.devices.keys());
        
        deviceIds.forEach(deviceId => {
            this.socket.emit('delete-device', { deviceId });
        });
        
        // Clear pending QR codes
        this.pendingQRDevices.clear();
        this.updateQRDisplay();
        
        this.showToast('Info', `Deleting ${deviceIds.length} devices...`, 'info');
    }

    refreshDevice(deviceId) {
        if (this.socket) {
            this.socket.emit('get-device-status', { deviceId });
        }
    }

    refreshDevices() {
        if (this.socket) {
            this.socket.emit('identify-user', { userId: this.userId });
        }
    }
    
    getQRCode(deviceId) {
        console.log('User clicked Get QR for device:', deviceId);
        const device = this.devices.get(deviceId);
        
        if (!device) {
            this.showToast('Error', 'Device not found', 'error');
            return;
        }
        
        const qrData = this.pendingQRDevices.get(deviceId);
        if (qrData) {
            // Show existing QR code in modal
            console.log('Showing existing QR code for device:', deviceId);
            this.showSingleQRCode(qrData);
        } else {
            // Request new QR code from server and show when received
            console.log('Requesting new QR code from server for device:', deviceId);
            this.showToast('Info', 'Generating QR code...', 'info');
            
            // Disable button temporarily
            const qrButton = document.getElementById(`qr-btn-${deviceId}`);
            if (qrButton) {
                const originalText = qrButton.innerHTML;
                qrButton.disabled = true;
                qrButton.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Generating...';
                
                // Reset button after timeout
                setTimeout(() => {
                    qrButton.innerHTML = originalText;
                    qrButton.disabled = false;
                }, 10000);
            }
            
            // Set up one-time listener for QR code response
            const onQRReceived = (data) => {
                if (data.deviceId === deviceId) {
                    this.socket.off('device-qr-code', onQRReceived);
                    // Automatically show the QR code when user requested it
                    setTimeout(() => {
                        const qrData = this.pendingQRDevices.get(deviceId);
                        if (qrData) {
                            this.showSingleQRCode(qrData);
                        }
                    }, 500);
                }
            };
            
            this.socket.on('device-qr-code', onQRReceived);
            this.socket.emit('get-device-qr', { deviceId });
        }
    }
    
    showSingleQRCode(qrData) {
        // Create modal for single QR code
        const modal = document.getElementById('qrCodeModal') || this.createQRModal();
        const modalTitle = modal.querySelector('.modal-title');
        const modalBody = modal.querySelector('.modal-body');
        
        modalTitle.innerHTML = `<i class="fas fa-qrcode me-2"></i>QR Code - ${qrData.deviceName}`;
        modalBody.innerHTML = `
            <div class="text-center">
                <img src="${qrData.qrCode}" class="img-fluid" style="max-width: 300px; width: 100%;">
                <div class="mt-3">
                    <p class="text-muted">Scan this QR code with WhatsApp on your mobile device</p>
                    <div class="spinner-border spinner-border-sm text-primary" role="status">
                        <span class="visually-hidden">Waiting for scan...</span>
                    </div>
                </div>
            </div>
        `;
        
        // Store device ID for later reference when closing
        modal.setAttribute('data-device-id', qrData.deviceId);
        
        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }
    
    createQRModal() {
        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = 'qrCodeModal';
        modal.tabIndex = -1;
        
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">QR Code</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <!-- QR code content will be inserted here -->
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            <i class="fas fa-times me-1"></i>Close
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        return modal;
    }

    updateDeviceStatus(data) {
        const device = this.devices.get(data.deviceId);
        if (device) {
            device.status = data.status;
            device.isReady = data.isReady;
            if (data.phoneNumber) {
                device.phoneNumber = data.phoneNumber;
            }
            
            this.refreshDevices();
        }
    }

    // Utility methods
    showFullScreenLoading(title = 'Processing...', message = 'Please wait...') {
        const loadingOverlay = document.getElementById('full-screen-loading');
        const loadingTitle = document.getElementById('loading-title');
        const loadingMessage = document.getElementById('loading-message');
        
        if (loadingOverlay) {
            loadingTitle.textContent = title;
            loadingMessage.textContent = message;
            loadingOverlay.style.display = 'flex';
            
            // Prevent scrolling and interaction
            document.body.style.overflow = 'hidden';
        }
    }
    
    hideFullScreenLoading() {
        const loadingOverlay = document.getElementById('full-screen-loading');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    }
    
    updateLoadingMessage(title, message) {
        const loadingTitle = document.getElementById('loading-title');
        const loadingMessage = document.getElementById('loading-message');
        
        if (loadingTitle && loadingMessage) {
            loadingTitle.textContent = title;
            loadingMessage.textContent = message;
        }
    }
    
    disableDeviceControls(disable) {
        // Disable/enable navigation links
        const navLinks = document.querySelectorAll('nav a.nav-link');
        navLinks.forEach(link => {
            if (disable) {
                link.style.pointerEvents = 'none';
                link.style.opacity = '0.5';
            } else {
                link.style.pointerEvents = 'auto';
                link.style.opacity = '1';
            }
        });
        
        // Disable/enable form controls
        const formControls = document.querySelectorAll('#bulk-device-count, #device-name-prefix, #bulk-add-devices-btn, #refresh-all-btn, #delete-all-btn');
        formControls.forEach(control => {
            control.disabled = disable;
        });
    }
    
    resetDeviceCreationState() {
        this.isDeviceCreationInProgress = false;
        this.devicesBeingCreated = 0;
        this.devicesCreatedCount = 0;
        this.totalDevicesToCreate = 0;
        
        // Hide inline loading message
        this.hideInlineLoadingMessage();
        
        // Re-enable form controls
        this.disableDeviceControls(false);
        console.log('Device creation state reset');
    }
    showLoadingMessage(show, message = '') {
        const loadingDiv = document.getElementById('device-loading-message');
        const tipDiv = document.getElementById('device-add-tip');
        
        if (show) {
            loadingDiv.style.display = 'block';
            if (tipDiv) tipDiv.style.display = 'none';
            
            if (message) {
                const messageText = loadingDiv.querySelector('div > div');
                if (messageText) {
                    messageText.innerHTML = `
                        <i class="fas fa-clock me-2"></i>
                        <strong>Please wait...</strong> ${message}
                    `;
                }
            }
        } else {
            loadingDiv.style.display = 'none';
            if (tipDiv) tipDiv.style.display = 'block';
        }
    }
    
    updateUserDisplay() {
        const userDisplay = document.getElementById('user-display-name');
        const userIdDisplay = document.getElementById('user-id-display');
        
        // Simply display the user ID since we're not using authentication
        if (userDisplay) {
            userDisplay.textContent = this.userId || 'User';
        }
        if (userIdDisplay) {
            userIdDisplay.textContent = this.userId;
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
    
    // Inline loading message functions
    showInlineLoadingMessage(message) {
        const loadingElement = document.getElementById('device-loading-message');
        const tipElement = document.getElementById('device-add-tip');
        
        if (loadingElement) {
            const messageDiv = loadingElement.querySelector('div div');
            if (messageDiv) {
                messageDiv.innerHTML = `
                    <i class="fas fa-clock me-2"></i>
                    <strong>Please wait...</strong> ${message}
                `;
            }
            loadingElement.style.display = 'block';
        }
        
        // Hide the tip when showing loading
        if (tipElement) {
            tipElement.style.display = 'none';
        }
    }
    
    updateInlineLoadingMessage(message) {
        const loadingElement = document.getElementById('device-loading-message');
        
        if (loadingElement && loadingElement.style.display === 'block') {
            const messageDiv = loadingElement.querySelector('div div');
            if (messageDiv) {
                messageDiv.innerHTML = `
                    <i class="fas fa-clock me-2"></i>
                    <strong>Please wait...</strong> ${message}
                `;
            }
        }
    }
    
    hideInlineLoadingMessage() {
        const loadingElement = document.getElementById('device-loading-message');
        const tipElement = document.getElementById('device-add-tip');
        
        if (loadingElement) {
            loadingElement.style.display = 'none';
        }
        
        // Show the tip again when hiding loading
        if (tipElement) {
            tipElement.style.display = 'block';
        }
    }
}

// Global instance
window.deviceManager = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.deviceManager = new DeviceManagerPage();
});