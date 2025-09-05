class HistoryManager {
    constructor() {
        this.userId = this.generateUserId();
        this.socket = null;
        this.campaigns = new Map();
        this.messages = [];
        this.currentFilters = {
            dateRange: 'all',
            status: 'all',
            search: ''
        };
        // Pagination settings
        this.pagination = {
            currentPage: 1,
            itemsPerPage: 10,
            totalItems: 0,
            totalPages: 0
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
        // Don't load history data here - wait for socket connection
    }



    initSocket() {
        console.log('Initializing Socket.IO connection for history page...');
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('History page connected to server');
            this.updateConnectionStatus('connected');
            this.socket.emit('identify-user', { userId: this.userId });
            console.log('User identified, requesting history data...');
            // Load history data immediately after connection
            setTimeout(() => {
                this.loadHistoryData();
            }, 1000); // Increased delay to ensure server is ready
        });
        
        this.socket.on('disconnect', () => {
            console.log('History page disconnected from server');
            this.updateConnectionStatus('disconnected');
        });

        this.socket.on('history-data', (data) => {
            console.log('Received history data:', data);
            this.handleHistoryData(data);
        });

        this.socket.on('history-cleared', (data) => {
            console.log('History cleared:', data);
            this.handleHistoryCleared(data);
        });

        this.socket.on('error', (error) => {
            console.error('Socket.IO error:', error);
            this.showToast('Error', error.message || 'Connection error', 'error');
        });
    }

    setupEventListeners() {
        // Filter controls
        document.getElementById('date-filter').addEventListener('change', (e) => {
            const customRange = document.getElementById('custom-date-range');
            customRange.style.display = e.target.value === 'custom' ? 'block' : 'none';
        });

        document.getElementById('apply-filters-btn').addEventListener('click', () => {
            this.applyFilters();
        });

        document.getElementById('refresh-history-btn').addEventListener('click', () => {
            this.loadHistoryData();
        });

        // Debug History button
        document.getElementById('debug-history-btn').addEventListener('click', () => {
            this.debugHistory();
        });

        // Test Messages button (for debugging)
        const testBtn = document.createElement('button');
        testBtn.className = 'btn btn-outline-warning';
        testBtn.innerHTML = '<i class="fas fa-flask me-2"></i>Test Messages';
        testBtn.onclick = () => this.createTestMessages();
        document.getElementById('debug-history-btn').parentNode.insertBefore(testBtn, document.getElementById('debug-history-btn'));

        document.getElementById('clear-history-btn').addEventListener('click', () => {
            this.clearHistory();
        });

        document.getElementById('search-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.applyFilters();
            }
        });
    }

    loadHistoryData() {
        console.log('Loading history data for user:', this.userId);
        if (!this.socket || !this.socket.connected) {
            console.error('Socket not connected, retrying in 2 seconds...');
            this.showToast('Warning', 'Connecting to server...', 'warning');
            setTimeout(() => {
                this.loadHistoryData();
            }, 2000);
            return;
        }
        
        this.socket.emit('get-history-data', { userId: this.userId });
        this.showToast('Loading', 'Fetching history data...', 'info');
        console.log('History data request sent');
        
        // Set a timeout to retry if no response in 5 seconds
        setTimeout(() => {
            if (this.campaigns.size === 0 && this.messages.length === 0) {
                console.log('No data received yet, retrying...');
                this.socket.emit('get-history-data', { userId: this.userId });
            }
        }, 5000);
    }

    handleHistoryData(data) {
        console.log('=== Processing History Data ===');
        console.log('Raw data received:', data);
        console.log('Campaigns array:', data.campaigns);
        console.log('Messages array:', data.messages);
        console.log('Campaigns received:', data.campaigns?.length || 0);
        console.log('Messages received:', data.messages?.length || 0);
        
        // Validate data structure
        if (!data.campaigns || !Array.isArray(data.campaigns)) {
            console.error('Invalid campaigns data:', data.campaigns);
            this.campaigns = new Map();
        } else {
            this.campaigns = new Map(data.campaigns.map(c => [c.id, c]));
        }
        
        if (!data.messages || !Array.isArray(data.messages)) {
            console.error('Invalid messages data:', data.messages);
            this.messages = [];
        } else {
            this.messages = data.messages;
            console.log('Sample message structure:', this.messages[0]);
        }
        
        console.log('Campaigns processed:', this.campaigns.size);
        console.log('Messages processed:', this.messages.length);
        console.log('=== End Processing History Data ===');
        
        this.updateStatistics();
        this.renderCampaignsTable();
        this.renderMessagesTable();
        this.renderAnalytics();
        
        this.showToast('Success', `Loaded ${this.campaigns.size} campaigns and ${this.messages.length} messages`, 'success');
    }

    updateStatistics() {
        const totalCampaigns = this.campaigns.size;
        const totalSent = this.messages.filter(m => m.status === 'sent').length;
        const totalFailed = this.messages.filter(m => m.status === 'failed').length;
        const successRate = totalSent + totalFailed > 0 ? ((totalSent / (totalSent + totalFailed)) * 100).toFixed(1) : 0;

        document.getElementById('total-campaigns').textContent = totalCampaigns;
        document.getElementById('total-messages-sent').textContent = totalSent;
        document.getElementById('total-messages-failed').textContent = totalFailed;
        document.getElementById('success-rate').textContent = successRate + '%';
    }

    renderCampaignsTable() {
        const tbody = document.getElementById('campaigns-table-body');
        const campaigns = Array.from(this.campaigns.values());
        
        // Update pagination
        this.pagination.totalItems = campaigns.length;
        this.pagination.totalPages = Math.ceil(campaigns.length / this.pagination.itemsPerPage);
        
        // Calculate pagination range
        const startIndex = (this.pagination.currentPage - 1) * this.pagination.itemsPerPage;
        const endIndex = startIndex + this.pagination.itemsPerPage;
        const paginatedCampaigns = campaigns.slice(startIndex, endIndex);
        
        if (paginatedCampaigns.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="text-center text-muted py-4">
                        <i class="fas fa-inbox me-2"></i>
                        No campaigns found
                    </td>
                </tr>
            `;
            this.renderPagination('campaigns');
            return;
        }

        tbody.innerHTML = paginatedCampaigns.map(campaign => {
            // ... existing code ...
            const createdDate = new Date(campaign.createdAt).toLocaleString();
            const duration = this.calculateDuration(campaign.createdAt, campaign.updatedAt);
            const successRate = campaign.progress ? 
                ((campaign.progress.sent / (campaign.progress.sent + campaign.progress.failed)) * 100).toFixed(1) : 0;
            
            return `
                <tr>
                    <td>
                        <strong>${campaign.name}</strong>
                        <br><small class="text-muted">${campaign.id.substring(0, 8)}...</small>
                    </td>
                    <td>${createdDate}</td>
                    <td>
                        <span class="badge bg-${this.getStatusColor(campaign.status)}">
                            ${campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
                        </span>
                    </td>
                    <td>${campaign.progress?.total || 0}</td>
                    <td>${campaign.progress?.sent || 0}</td>
                    <td>${campaign.progress?.failed || 0}</td>
                    <td>${successRate}%</td>
                    <td>${duration}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" onclick="historyManager.showCampaignDetails('${campaign.id}')">
                            <i class="fas fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Render pagination controls
        this.renderPagination('campaigns');
    }

    renderMessagesTable() {
        const tbody = document.getElementById('messages-table-body');
        
        // Calculate pagination for messages
        const startIndex = (this.pagination.currentPage - 1) * this.pagination.itemsPerPage;
        const endIndex = startIndex + this.pagination.itemsPerPage;
        const paginatedMessages = this.messages.slice(startIndex, endIndex);
        
        if (paginatedMessages.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center text-muted py-4">
                        <i class="fas fa-inbox me-2"></i>
                        No messages found
                    </td>
                </tr>
            `;
            this.renderPagination('messages');
            return;
        }

        tbody.innerHTML = paginatedMessages.map(message => {
            // ... existing code ...
            const timestamp = new Date(message.timestamp).toLocaleString();
            const truncatedMessage = message.content.length > 50 ? 
                message.content.substring(0, 50) + '...' : message.content;
            
            return `
                <tr>
                    <td>${timestamp}</td>
                    <td>
                        <strong>${message.recipient.name || 'Unknown'}</strong>
                        <br><small class="text-muted">${message.recipient.phoneNumber}</small>
                    </td>
                    <td>${truncatedMessage}</td>
                    <td>${message.deviceName}</td>
                    <td>
                        <span class="badge bg-${message.status === 'sent' ? 'success' : 'danger'}">
                            ${message.status.charAt(0).toUpperCase() + message.status.slice(1)}
                        </span>
                    </td>
                    <td>${message.campaignName || 'Single Message'}</td>
                    <td>${message.responseTime || 'N/A'}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" onclick="historyManager.showMessageDetails('${message.id}')">
                            <i class="fas fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Render pagination controls
        this.renderPagination('messages');
    }

    renderAnalytics() {
        console.log('Rendering analytics with', this.messages.length, 'messages');
        
        // Analytics implementation
        const statusChart = document.getElementById('status-chart');
        const timelineChart = document.getElementById('timeline-chart');
        const deviceStats = document.getElementById('device-usage-stats');

        // Status distribution
        const sent = this.messages.filter(m => m.status === 'sent').length;
        const failed = this.messages.filter(m => m.status === 'failed').length;
        
        console.log('Analytics stats:', { sent, failed, total: this.messages.length });
        
        if (statusChart) {
            if (sent > 0 || failed > 0) {
                statusChart.innerHTML = `
                    <div class="row text-center">
                        <div class="col-6">
                            <div class="text-success">
                                <i class="fas fa-check-circle fa-2x"></i>
                                <h4>${sent}</h4>
                                <small>Sent (${((sent / (sent + failed)) * 100).toFixed(1)}%)</small>
                            </div>
                        </div>
                        <div class="col-6">
                            <div class="text-danger">
                                <i class="fas fa-times-circle fa-2x"></i>
                                <h4>${failed}</h4>
                                <small>Failed (${((failed / (sent + failed)) * 100).toFixed(1)}%)</small>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                statusChart.innerHTML = `
                    <div class="text-center text-muted py-4">
                        <i class="fas fa-chart-pie fa-3x mb-3"></i>
                        <h5>No Message Data</h5>
                        <p>Send some campaigns to see analytics</p>
                    </div>
                `;
            }
        }
        
        // Device usage stats
        if (deviceStats) {
            const deviceUsage = {};
            this.messages.forEach(message => {
                if (message.deviceName) {
                    deviceUsage[message.deviceName] = (deviceUsage[message.deviceName] || 0) + 1;
                }
            });
            
            if (Object.keys(deviceUsage).length > 0) {
                const deviceStatsHTML = Object.entries(deviceUsage)
                    .map(([device, count]) => {
                        const percentage = ((count / this.messages.length) * 100).toFixed(1);
                        return `
                            <div class="mb-2">
                                <div class="d-flex justify-content-between align-items-center">
                                    <small class="fw-bold">${device}</small>
                                    <small class="text-muted">${count} (${percentage}%)</small>
                                </div>
                                <div class="progress" style="height: 6px;">
                                    <div class="progress-bar bg-primary" style="width: ${percentage}%"></div>
                                </div>
                            </div>
                        `;
                    }).join('');
                
                deviceStats.innerHTML = `
                    <h6 class="mb-3">Device Usage Distribution</h6>
                    ${deviceStatsHTML}
                `;
            } else {
                deviceStats.innerHTML = `
                    <div class="text-center text-muted py-4">
                        <i class="fas fa-mobile-alt fa-2x mb-2"></i>
                        <p>No device usage data available</p>
                    </div>
                `;
            }
        }
        
        // Timeline chart (simple implementation)
        if (timelineChart) {
            if (this.messages.length > 0) {
                // Group messages by hour
                const hourlyData = {};
                this.messages.forEach(message => {
                    const hour = new Date(message.timestamp).getHours();
                    hourlyData[hour] = (hourlyData[hour] || 0) + 1;
                });
                
                const chartHTML = Object.entries(hourlyData)
                    .sort(([a], [b]) => parseInt(a) - parseInt(b))
                    .map(([hour, count]) => {
                        const maxCount = Math.max(...Object.values(hourlyData));
                        const height = (count / maxCount) * 100;
                        return `
                            <div class="d-flex flex-column align-items-center mx-1">
                                <small class="text-muted mb-1">${count}</small>
                                <div class="bg-primary" style="width: 20px; height: ${height}px; min-height: 10px;"></div>
                                <small class="text-muted mt-1">${hour}:00</small>
                            </div>
                        `;
                    }).join('');
                
                timelineChart.innerHTML = `
                    <h6 class="mb-3">Messages by Hour</h6>
                    <div class="d-flex align-items-end justify-content-center" style="height: 120px;">
                        ${chartHTML}
                    </div>
                `;
            } else {
                timelineChart.innerHTML = `
                    <div class="text-center text-muted py-4">
                        <i class="fas fa-chart-line fa-2x mb-2"></i>
                        <p>No timeline data available</p>
                    </div>
                `;
            }
        }
    }

    calculateDuration(start, end) {
        const startTime = new Date(start);
        const endTime = new Date(end);
        const diff = Math.abs(endTime - startTime);
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    }

    getStatusColor(status) {
        const colors = {
            'active': 'primary',
            'completed': 'success',
            'paused': 'warning',
            'failed': 'danger',
            'cancelled': 'secondary'
        };
        return colors[status] || 'secondary';
    }

    showCampaignDetails(campaignId) {
        const campaign = this.campaigns.get(campaignId);
        if (!campaign) return;

        const modal = new bootstrap.Modal(document.getElementById('campaignDetailsModal'));
        const content = document.getElementById('campaign-details-content');
        
        content.innerHTML = `
            <div class="row">
                <div class="col-md-6">
                    <h6>Campaign Information</h6>
                    <table class="table table-sm">
                        <tr><th>Name:</th><td>${campaign.name}</td></tr>
                        <tr><th>ID:</th><td>${campaign.id}</td></tr>
                        <tr><th>Status:</th><td><span class="badge bg-${this.getStatusColor(campaign.status)}">${campaign.status}</span></td></tr>
                        <tr><th>Created:</th><td>${new Date(campaign.createdAt).toLocaleString()}</td></tr>
                        <tr><th>Updated:</th><td>${new Date(campaign.updatedAt).toLocaleString()}</td></tr>
                    </table>
                </div>
                <div class="col-md-6">
                    <h6>Progress Statistics</h6>
                    <table class="table table-sm">
                        <tr><th>Total Recipients:</th><td>${campaign.progress?.total || 0}</td></tr>
                        <tr><th>Messages Sent:</th><td>${campaign.progress?.sent || 0}</td></tr>
                        <tr><th>Messages Failed:</th><td>${campaign.progress?.failed || 0}</td></tr>
                        <tr><th>Success Rate:</th><td>${campaign.progress ? ((campaign.progress.sent / (campaign.progress.sent + campaign.progress.failed)) * 100).toFixed(1) : 0}%</td></tr>
                    </table>
                </div>
            </div>
            <div class="mt-3">
                <h6>Message Template</h6>
                <div class="border p-3 bg-light rounded">
                    ${campaign.message || 'No message template available'}
                </div>
            </div>
        `;
        
        modal.show();
    }

    showMessageDetails(messageId) {
        const message = this.messages.find(m => m.id === messageId);
        if (!message) return;

        const modal = new bootstrap.Modal(document.getElementById('messageDetailsModal'));
        const content = document.getElementById('message-details-content');
        
        content.innerHTML = `
            <div class="row">
                <div class="col-md-6">
                    <h6>Message Information</h6>
                    <table class="table table-sm">
                        <tr><th>Timestamp:</th><td>${new Date(message.timestamp).toLocaleString()}</td></tr>
                        <tr><th>Status:</th><td><span class="badge bg-${message.status === 'sent' ? 'success' : 'danger'}">${message.status}</span></td></tr>
                        <tr><th>Device:</th><td>${message.deviceName}</td></tr>
                        <tr><th>Response Time:</th><td>${message.responseTime || 'N/A'}</td></tr>
                    </table>
                </div>
                <div class="col-md-6">
                    <h6>Recipient Information</h6>
                    <table class="table table-sm">
                        <tr><th>Name:</th><td>${message.recipient.name || 'Unknown'}</td></tr>
                        <tr><th>Phone:</th><td>${message.recipient.phoneNumber}</td></tr>
                        <tr><th>Campaign:</th><td>${message.campaignName || 'Single Message'}</td></tr>
                    </table>
                </div>
            </div>
            <div class="mt-3">
                <h6>Message Content</h6>
                <div class="border p-3 bg-light rounded">
                    ${message.content}
                </div>
            </div>
        `;
        
        modal.show();
    }

    updateConnectionStatus(status) {
        const connectionStatus = document.getElementById('connection-status');
        if (!connectionStatus) return;
        
        const badge = connectionStatus.querySelector('.badge');
        if (status === 'connected') {
            badge.className = 'badge bg-success';
            badge.innerHTML = '<i class="fas fa-check-circle me-1"></i>Connected';
        } else {
            badge.className = 'badge bg-danger';
            badge.innerHTML = '<i class="fas fa-times-circle me-1"></i>Disconnected';
        }
    }

    updateUserDisplay() {
        // Simply display the user ID since we're not using authentication
        const userDisplay = document.getElementById('user-display-name');
        if (userDisplay) {
            userDisplay.textContent = this.userId || 'User';
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
                const icons = {
                    'success': 'fas fa-check-circle text-success',
                    'error': 'fas fa-exclamation-circle text-danger',
                    'warning': 'fas fa-exclamation-triangle text-warning',
                    'info': 'fas fa-info-circle text-info'
                };
                toastIcon.className = icons[type] + ' me-2';
            }
            
            new bootstrap.Toast(toast).show();
        }
    }

    debugHistory() {
        console.log('=== COMPREHENSIVE HISTORY DEBUG ===');
        console.log('User ID:', this.userId);
        console.log('Socket connected:', this.socket?.connected);
        console.log('Socket ID:', this.socket?.id);
        console.log('Campaigns count:', this.campaigns.size);
        console.log('Messages count:', this.messages.length);
        
        // Debug campaigns
        console.log('=== CAMPAIGNS DEBUG ===');
        if (this.campaigns.size > 0) {
            Array.from(this.campaigns.values()).forEach((campaign, index) => {
                console.log(`Campaign ${index + 1}:`, {
                    id: campaign.id,
                    name: campaign.name,
                    status: campaign.status,
                    progress: campaign.progress
                });
            });
        } else {
            console.log('No campaigns found');
        }
        
        // Debug messages
        console.log('=== MESSAGES DEBUG ===');
        if (this.messages.length > 0) {
            this.messages.forEach((message, index) => {
                console.log(`Message ${index + 1}:`, {
                    id: message.id,
                    recipient: message.recipient?.phoneNumber,
                    status: message.status,
                    deviceName: message.deviceName,
                    timestamp: message.timestamp
                });
            });
        } else {
            console.log('No messages found');
        }
        
        // Debug DOM elements
        console.log('=== DOM ELEMENTS DEBUG ===');
        const elements = {
            'campaigns-table-body': document.getElementById('campaigns-table-body'),
            'messages-table-body': document.getElementById('messages-table-body'),
            'status-chart': document.getElementById('status-chart'),
            'timeline-chart': document.getElementById('timeline-chart'),
            'device-usage-stats': document.getElementById('device-usage-stats')
        };
        
        Object.entries(elements).forEach(([id, element]) => {
            console.log(`Element '${id}':`, element ? 'Found' : 'NOT FOUND');
            if (element) {
                console.log(`  - innerHTML length: ${element.innerHTML.length}`);
                console.log(`  - Content preview: ${element.innerHTML.substring(0, 100)}...`);
            }
        });
        
        // Test message rendering
        console.log('=== TESTING MESSAGE RENDERING ===');
        if (this.messages.length > 0) {
            console.log('Attempting to render messages...');
            this.renderMessagesTable();
            console.log('Messages rendering completed');
        }
        
        // Force reload data
        console.log('=== FORCE RELOAD DATA ===');
        if (this.socket && this.socket.connected) {
            this.socket.emit('get-history-data', { userId: this.userId });
            this.showToast('Debug', 'Debug: Force requested history data', 'info');
        } else {
            this.showToast('Debug', 'Debug: Socket not connected', 'warning');
        }
        
        console.log('=== END COMPREHENSIVE DEBUG ===');
    }

    createTestMessages() {
        console.log('Creating test messages for debugging...');
        
        // Create test messages locally for debugging
        this.messages = [
            {
                id: 'test-1',
                userId: this.userId,
                campaignId: 'camp-1',
                campaignName: 'Test Campaign 1',
                recipient: { name: 'John Doe', phoneNumber: '+1234567890' },
                content: 'Hello John, this is a test message from our campaign.',
                deviceId: 'dev-1',
                deviceName: 'WhatsApp-Device-1',
                status: 'sent',
                timestamp: new Date(Date.now() - 3600000),
                responseTime: '2.3s'
            },
            {
                id: 'test-2',
                userId: this.userId,
                campaignId: 'camp-1',
                campaignName: 'Test Campaign 1',
                recipient: { name: 'Jane Smith', phoneNumber: '+1234567891' },
                content: 'Hello Jane, this is another test message.',
                deviceId: 'dev-2',
                deviceName: 'WhatsApp-Device-2',
                status: 'sent',
                timestamp: new Date(Date.now() - 1800000),
                responseTime: '1.8s'
            },
            {
                id: 'test-3',
                userId: this.userId,
                campaignId: 'camp-2',
                campaignName: 'Test Campaign 2',
                recipient: { name: 'Bob Wilson', phoneNumber: '+1234567892' },
                content: 'Failed message test.',
                deviceId: null,
                deviceName: 'Failed',
                status: 'failed',
                timestamp: new Date(Date.now() - 900000),
                responseTime: null,
                error: 'Network timeout'
            }
        ];
        
        console.log('Test messages created:', this.messages.length);
        
        // Re-render everything
        this.updateStatistics();
        this.renderCampaignsTable();
        this.renderMessagesTable();
        this.renderAnalytics();
        
        this.showToast('Debug', 'Test messages created successfully!', 'success');
    }

    renderPagination(type) {
        const paginationId = `${type}-pagination`;
        let paginationContainer = document.getElementById(paginationId);
        
        if (!paginationContainer) {
            // Create pagination container if it doesn't exist
            const tabContent = document.querySelector(`#${type}`);
            if (tabContent) {
                paginationContainer = document.createElement('div');
                paginationContainer.id = paginationId;
                paginationContainer.className = 'mt-3';
                tabContent.appendChild(paginationContainer);
            } else {
                return;
            }
        }
        
        if (this.pagination.totalPages <= 1) {
            paginationContainer.innerHTML = '';
            return;
        }
        
        let paginationHTML = `
            <nav>
                <ul class="pagination justify-content-center">
                    <li class="page-item ${this.pagination.currentPage === 1 ? 'disabled' : ''}">
                        <button class="page-link" onclick="historyManager.goToPage(${this.pagination.currentPage - 1})" ${this.pagination.currentPage === 1 ? 'disabled' : ''}>
                            <i class="fas fa-chevron-left"></i> Previous
                        </button>
                    </li>
        `;
        
        // Add page numbers
        for (let i = 1; i <= this.pagination.totalPages; i++) {
            if (i === this.pagination.currentPage) {
                paginationHTML += `
                    <li class="page-item active">
                        <span class="page-link">${i}</span>
                    </li>
                `;
            } else if (Math.abs(i - this.pagination.currentPage) <= 2 || i === 1 || i === this.pagination.totalPages) {
                paginationHTML += `
                    <li class="page-item">
                        <button class="page-link" onclick="historyManager.goToPage(${i})">${i}</button>
                    </li>
                `;
            } else if (Math.abs(i - this.pagination.currentPage) === 3) {
                paginationHTML += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            }
        }
        
        paginationHTML += `
                    <li class="page-item ${this.pagination.currentPage === this.pagination.totalPages ? 'disabled' : ''}">
                        <button class="page-link" onclick="historyManager.goToPage(${this.pagination.currentPage + 1})" ${this.pagination.currentPage === this.pagination.totalPages ? 'disabled' : ''}>
                            Next <i class="fas fa-chevron-right"></i>
                        </button>
                    </li>
                </ul>
            </nav>
            <div class="text-center text-muted">
                <small>Page ${this.pagination.currentPage} of ${this.pagination.totalPages} (${this.pagination.totalItems} total items)</small>
            </div>
        `;
        
        paginationContainer.innerHTML = paginationHTML;
    }
    
    goToPage(page) {
        if (page >= 1 && page <= this.pagination.totalPages) {
            this.pagination.currentPage = page;
            this.renderCampaignsTable();
            this.renderMessagesTable();
        }
    }
    
    clearHistory() {
        if (confirm('Are you sure you want to clear all history? This action cannot be undone.')) {
            console.log('Clearing history for user:', this.userId);
            this.socket.emit('clear-history-data', { userId: this.userId });
            this.showToast('Loading', 'Clearing history...', 'info');
        }
    }
    
    handleHistoryCleared(data) {
        if (data.success) {
            // Clear local data
            this.campaigns.clear();
            this.messages = [];
            this.pagination.currentPage = 1;
            
            // Re-render everything
            this.updateStatistics();
            this.renderCampaignsTable();
            this.renderMessagesTable();
            this.renderAnalytics();
            
            this.showToast('Success', 'History cleared successfully', 'success');
        } else {
            this.showToast('Error', 'Failed to clear history', 'error');
        }
    }
}

// Initialize history manager when DOM is loaded
let historyManager;
document.addEventListener('DOMContentLoaded', () => {
    historyManager = new HistoryManager();
});