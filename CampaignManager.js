const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class CampaignManager {
    constructor(io, deviceManager) {
        this.io = io;
        this.deviceManager = deviceManager;
        this.campaigns = new Map(); // Map<campaignId, campaign>
        this.userCampaigns = new Map(); // Map<userId, Set<campaignId>>
        this.campaignTimers = new Map(); // Map<campaignId, timeoutId>
        this.messageHistory = new Map(); // Map<userId, Array<message>> - Store individual messages
        
        // File path for persistent storage
        this.campaignsFilePath = path.join(__dirname, 'campaigns.json');
        this.messagesFilePath = path.join(__dirname, 'messages.json');
        
        // Load existing campaigns and messages on startup
        this.loadCampaigns();
        this.loadMessages();
        
        // Start recovery service for interrupted campaigns
        this.startCampaignRecovery();
    }

    /**
     * Create and start a new campaign
     */
    async createCampaign(userId, campaignData) {
        const campaignId = uuidv4();
        const campaign = {
            id: campaignId,
            userId: userId,
            name: campaignData.name || `Campaign ${Date.now()}`,
            message: campaignData.message,
            recipients: campaignData.recipients,
            attachment: campaignData.attachment,
            options: {
                delay: campaignData.delay || 2000,
                rotationStrategy: campaignData.rotationStrategy || 'round-robin',
                selectedDevices: campaignData.selectedDevices,
                messagesPerDevice: campaignData.messagesPerDevice || 10,
                customMinDelay: campaignData.customMinDelay,
                customMaxDelay: campaignData.customMaxDelay,
                enableTypingSimulation: campaignData.enableTypingSimulation !== false
            },
            status: 'active',
            progress: {
                total: campaignData.recipients.length,
                sent: 0,
                failed: 0,
                currentIndex: 0
            },
            rotationState: {
                strategy: campaignData.rotationStrategy || 'round-robin',
                deviceIndex: 0,
                deviceUsage: new Map(),
                deviceLastUsed: new Map(),
                currentDeviceMessageCount: 0,
                currentDevice: null
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            lastProcessedAt: new Date()
        };

        // Store campaign
        this.campaigns.set(campaignId, campaign);
        
        // Add to user's campaigns
        if (!this.userCampaigns.has(userId)) {
            this.userCampaigns.set(userId, new Set());
        }
        this.userCampaigns.get(userId).add(campaignId);

        // Save to disk for persistence
        this.saveCampaigns();

        // Start processing campaign
        this.processCampaign(campaignId);

        return campaign;
    }

    /**
     * Process campaign messages with persistence and recovery
     */
    async processCampaign(campaignId) {
        const campaign = this.campaigns.get(campaignId);
        if (!campaign || campaign.status !== 'active') {
            return;
        }

        try {
            // Ensure rotation state Maps are properly initialized
            if (!campaign.rotationState.deviceUsage || !(campaign.rotationState.deviceUsage instanceof Map)) {
                campaign.rotationState.deviceUsage = new Map();
            }
            if (!campaign.rotationState.deviceLastUsed || !(campaign.rotationState.deviceLastUsed instanceof Map)) {
                campaign.rotationState.deviceLastUsed = new Map();
            }
            
            const readyDevices = this.deviceManager.getReadyDevices(campaign.userId);
            
            if (readyDevices.length === 0) {
                // No devices available, retry in 30 seconds
                this.scheduleRetry(campaignId, 30000);
                return;
            }

            // Apply device filtering if specified
            console.log(`Campaign ${campaignId}: Available ready devices:`, readyDevices.map(d => ({ id: d.id, name: d.name })));
            console.log(`Campaign ${campaignId}: Selected devices configuration:`, campaign.options.selectedDevices);
            
            const selectedDevices = campaign.options.selectedDevices ? 
                readyDevices.filter(d => campaign.options.selectedDevices.includes(d.id)) : 
                readyDevices;
                
            console.log(`Campaign ${campaignId}: Filtered selected devices:`, selectedDevices.map(d => ({ id: d.id, name: d.name })));
                
            if (selectedDevices.length === 0) {
                console.log(`Campaign ${campaignId}: No selected devices ready, retrying in 30 seconds`);
                // No selected devices ready, retry in 30 seconds
                this.scheduleRetry(campaignId, 30000);
                return;
            }

            // Initialize rotation state if needed
            if (campaign.rotationState.deviceUsage.size === 0) {
                selectedDevices.forEach(device => {
                    campaign.rotationState.deviceUsage.set(device.id, 0);
                    campaign.rotationState.deviceLastUsed.set(device.id, 0);
                });
            }

            // Process one message at a time for reliability
            if (campaign.progress.currentIndex < campaign.recipients.length) {
                const recipient = campaign.recipients[campaign.progress.currentIndex];
                
                try {
                    // Select device based on strategy
                    console.log(`Campaign ${campaignId}: Selecting device using strategy '${campaign.options.rotationStrategy}' from ${selectedDevices.length} devices`);
                    const device = this.selectDeviceByStrategy(selectedDevices, campaign.rotationState, campaign.options);
                    console.log(`Campaign ${campaignId}: Selected device:`, { id: device.id, name: device.name });
                    
                    // Emit progress update
                    this.io.to(campaign.userId).emit('bulk-message-progress', {
                        campaignId: campaignId,
                        campaignName: campaign.name,
                        current: campaign.progress.currentIndex + 1,
                        total: campaign.progress.total,
                        sent: campaign.progress.sent,
                        failed: campaign.progress.failed,
                        recipient: recipient.phoneNumber,
                        deviceId: device.id,
                        deviceName: device.name,
                        enableTypingSimulation: campaign.options.enableTypingSimulation !== false
                    });

                    // Send message with typing simulation
                    const personalizedMessage = this.personalizeMessage(campaign.message, recipient);
                    console.log(`Sending message to ${recipient.phoneNumber} with typing simulation: ${campaign.options.enableTypingSimulation !== false}`);
                    await this.deviceManager.sendMessage(device.id, recipient.phoneNumber, personalizedMessage, campaign.attachment, {
                        enableTypingSimulation: campaign.options.enableTypingSimulation !== false
                    });
                    
                    // Update progress
                    campaign.progress.sent++;
                    this.updateRotationState(campaign.rotationState, device.id, campaign.options);
                    
                    // Store message in history
                    this.storeMessage({
                        id: uuidv4(),
                        userId: campaign.userId,
                        campaignId: campaignId,
                        campaignName: campaign.name,
                        recipient: recipient,
                        content: personalizedMessage,
                        deviceId: device.id,
                        deviceName: device.name,
                        status: 'sent',
                        timestamp: new Date(),
                        responseTime: null
                    });
                    
                    // Emit success
                    this.io.to(campaign.userId).emit('bulk-message-sent', {
                        campaignId: campaignId,
                        recipient: recipient,
                        success: true,
                        deviceId: device.id,
                        deviceName: device.name
                    });

                } catch (error) {
                    console.error(`Error sending message in campaign ${campaignId}:`, error);
                    
                    campaign.progress.failed++;
                    
                    // Store failed message in history
                    this.storeMessage({
                        id: uuidv4(),
                        userId: campaign.userId,
                        campaignId: campaignId,
                        campaignName: campaign.name,
                        recipient: recipient,
                        content: this.personalizeMessage(campaign.message, recipient),
                        deviceId: null,
                        deviceName: 'Failed',
                        status: 'failed',
                        timestamp: new Date(),
                        responseTime: null,
                        error: error.message
                    });
                    
                    // Emit error
                    this.io.to(campaign.userId).emit('bulk-message-error', {
                        campaignId: campaignId,
                        recipient: recipient,
                        error: error.message
                    });
                }

                // Update campaign state
                campaign.progress.currentIndex++;
                campaign.updatedAt = new Date();
                campaign.lastProcessedAt = new Date();
                
                // Save progress to disk
                this.saveCampaigns();

                // Check if campaign is complete
                if (campaign.progress.currentIndex >= campaign.recipients.length) {
                    this.completeCampaign(campaignId);
                } else {
                    // Schedule next message with calculated delay
                    const delay = this.calculateMessageDelay(campaign.options);
                    this.scheduleNextMessage(campaignId, delay);
                }
            }

        } catch (error) {
            console.error(`Error processing campaign ${campaignId}:`, error);
            // Retry in 60 seconds on error
            this.scheduleRetry(campaignId, 60000);
        }
    }

    /**
     * Calculate message delay with support for random delays
     */
    calculateMessageDelay(options) {
        const delayOption = options.delay;
        
        if (delayOption === 'random-fast') {
            return Math.floor(Math.random() * (5000 - 2000 + 1)) + 2000; // 2-5 seconds
        } else if (delayOption === 'random-normal') {
            return Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000; // 5-10 seconds
        } else if (delayOption === 'random-safe') {
            return Math.floor(Math.random() * (20000 - 10000 + 1)) + 10000; // 10-20 seconds
        } else if (delayOption === 'custom' && options.customMinDelay && options.customMaxDelay) {
            const minDelay = options.customMinDelay * 1000;
            const maxDelay = options.customMaxDelay * 1000;
            return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        }
        
        return parseInt(delayOption) || 2000;
    }

    /**
     * Select device based on rotation strategy with custom message count support
     */
    selectDeviceByStrategy(devices, rotationState, options) {
        switch (options.rotationStrategy) {
            case 'custom-count':
                return this.selectCustomCount(devices, rotationState, options.messagesPerDevice || 10);
            case 'round-robin':
                return this.selectRoundRobin(devices, rotationState);
            case 'random':
                return this.selectRandom(devices);
            case 'load-balanced':
                return this.selectLoadBalanced(devices, rotationState);
            default:
                return this.selectRoundRobin(devices, rotationState);
        }
    }

    /**
     * Custom message count device selection
     */
    selectCustomCount(devices, rotationState, messagesPerDevice) {
        // Use current device until message count reached
        if (!rotationState.currentDevice || 
            rotationState.currentDeviceMessageCount >= messagesPerDevice) {
            // Time to switch to next device
            rotationState.deviceIndex = (rotationState.deviceIndex + 1) % devices.length;
            rotationState.currentDevice = devices[rotationState.deviceIndex];
            rotationState.currentDeviceMessageCount = 0;
        }
        rotationState.currentDeviceMessageCount++;
        return rotationState.currentDevice;
    }

    /**
     * Round-robin device selection
     */
    selectRoundRobin(devices, rotationState) {
        const device = devices[rotationState.deviceIndex % devices.length];
        rotationState.deviceIndex++;
        return device;
    }

    /**
     * Random device selection
     */
    selectRandom(devices) {
        const randomIndex = Math.floor(Math.random() * devices.length);
        return devices[randomIndex];
    }

    /**
     * Load-balanced device selection
     */
    selectLoadBalanced(devices, rotationState) {
        // Ensure deviceUsage is a Map
        if (!rotationState.deviceUsage || !(rotationState.deviceUsage instanceof Map)) {
            rotationState.deviceUsage = new Map();
        }
        
        let selectedDevice = devices[0];
        let minUsage = rotationState.deviceUsage.get(selectedDevice.id) || 0;
        
        for (const device of devices) {
            const usage = rotationState.deviceUsage.get(device.id) || 0;
            if (usage < minUsage) {
                minUsage = usage;
                selectedDevice = device;
            }
        }
        
        return selectedDevice;
    }

    /**
     * Update rotation state after device usage
     */
    updateRotationState(rotationState, deviceId, options) {
        // Ensure deviceUsage and deviceLastUsed are Maps
        if (!rotationState.deviceUsage || !(rotationState.deviceUsage instanceof Map)) {
            rotationState.deviceUsage = new Map();
        }
        if (!rotationState.deviceLastUsed || !(rotationState.deviceLastUsed instanceof Map)) {
            rotationState.deviceLastUsed = new Map();
        }
        
        const currentUsage = rotationState.deviceUsage.get(deviceId) || 0;
        rotationState.deviceUsage.set(deviceId, currentUsage + 1);
        rotationState.deviceLastUsed.set(deviceId, Date.now());
    }

    /**
     * Schedule next message in campaign
     */
    scheduleNextMessage(campaignId, delay) {
        const timeoutId = setTimeout(() => {
            this.processCampaign(campaignId);
        }, delay);
        
        this.campaignTimers.set(campaignId, timeoutId);
    }

    /**
     * Schedule retry for campaign
     */
    scheduleRetry(campaignId, delay) {
        console.log(`Scheduling retry for campaign ${campaignId} in ${delay}ms`);
        this.scheduleNextMessage(campaignId, delay);
    }

    /**
     * Complete campaign
     */
    completeCampaign(campaignId) {
        const campaign = this.campaigns.get(campaignId);
        if (!campaign) return;

        campaign.status = 'completed';
        campaign.updatedAt = new Date();
        
        // Clear any scheduled timers
        if (this.campaignTimers.has(campaignId)) {
            clearTimeout(this.campaignTimers.get(campaignId));
            this.campaignTimers.delete(campaignId);
        }

        // Ensure deviceUsage is a Map before converting
        let deviceUsageObj = {};
        if (campaign.rotationState && campaign.rotationState.deviceUsage) {
            if (campaign.rotationState.deviceUsage instanceof Map) {
                deviceUsageObj = Object.fromEntries(campaign.rotationState.deviceUsage);
            } else if (typeof campaign.rotationState.deviceUsage === 'object') {
                deviceUsageObj = campaign.rotationState.deviceUsage;
            }
        }

        // Emit completion
        this.io.to(campaign.userId).emit('bulk-message-complete', {
            campaignId: campaignId,
            campaignName: campaign.name,
            total: campaign.progress.total,
            successful: campaign.progress.sent,
            failed: campaign.progress.failed,
            rotationStats: {
                strategy: campaign.rotationState?.strategy || 'round-robin',
                deviceUsage: deviceUsageObj
            }
        });

        // Save final state
        this.saveCampaigns();

        console.log(`Campaign ${campaignId} completed: ${campaign.progress.sent}/${campaign.progress.total} messages sent`);
    }

    /**
     * Store message in history
     */
    storeMessage(messageData) {
        const userId = messageData.userId;
        
        if (!this.messageHistory.has(userId)) {
            this.messageHistory.set(userId, []);
        }
        
        this.messageHistory.get(userId).push(messageData);
        
        // Save messages to disk
        this.saveMessages();
        
        console.log(`Stored message for user ${userId}:`, messageData.recipient.phoneNumber, messageData.status);
    }

    /**
     * Get user messages
     */
    getUserMessages(userId) {
        return this.messageHistory.get(userId) || [];
    }

    /**
     * Clear user messages
     */
    clearUserMessages(userId) {
        this.messageHistory.delete(userId);
        this.saveMessages();
        console.log(`Cleared messages for user: ${userId}`);
    }

    /**
     * Load messages from disk
     */
    loadMessages() {
        try {
            if (fs.existsSync(this.messagesFilePath)) {
                const data = fs.readFileSync(this.messagesFilePath, 'utf8');
                const savedMessages = JSON.parse(data);
                
                // Rebuild message history map
                for (const [userId, messages] of Object.entries(savedMessages)) {
                    this.messageHistory.set(userId, messages);
                }
                
                const totalMessages = Object.values(savedMessages).reduce((sum, arr) => sum + arr.length, 0);
                console.log(`Loaded ${totalMessages} messages from disk`);
            }
        } catch (error) {
            console.error('Error loading messages:', error);
            this.messageHistory.clear();
        }
    }

    /**
     * Save messages to disk
     */
    saveMessages() {
        try {
            const messagesToSave = Object.fromEntries(this.messageHistory);
            fs.writeFileSync(this.messagesFilePath, JSON.stringify(messagesToSave, null, 2));
        } catch (error) {
            console.error('Error saving messages:', error);
        }
    }

    /**
     * Stop campaign manually
     */
    stopCampaign(campaignId, userId) {
        const campaign = this.campaigns.get(campaignId);
        if (!campaign || campaign.userId !== userId) {
            return false;
        }

        campaign.status = 'stopped';
        campaign.updatedAt = new Date();

        // Clear scheduled timers
        if (this.campaignTimers.has(campaignId)) {
            clearTimeout(this.campaignTimers.get(campaignId));
            this.campaignTimers.delete(campaignId);
        }

        // Save state
        this.saveCampaigns();

        // Emit stop event
        this.io.to(userId).emit('campaign-stopped', {
            campaignId: campaignId,
            campaignName: campaign.name
        });

        return true;
    }

    /**
     * Restart campaign (reset progress and start again)
     */
    restartCampaign(campaignId, userId) {
        const campaign = this.campaigns.get(campaignId);
        if (!campaign || campaign.userId !== userId) {
            return false;
        }

        // Reset campaign progress
        campaign.status = 'active';
        campaign.progress.currentIndex = 0;
        campaign.progress.sent = 0;
        campaign.progress.failed = 0;
        campaign.updatedAt = new Date();
        campaign.startedAt = new Date();
        
        // Reset rotation state
        campaign.rotationState.deviceIndex = 0;
        campaign.rotationState.currentDeviceMessageCount = 0;
        campaign.rotationState.currentDevice = null;
        
        // Reset device usage counters
        if (campaign.rotationState.deviceUsage instanceof Map) {
            campaign.rotationState.deviceUsage.clear();
        } else {
            campaign.rotationState.deviceUsage = new Map();
        }
        
        if (campaign.rotationState.deviceLastUsed instanceof Map) {
            campaign.rotationState.deviceLastUsed.clear();
        } else {
            campaign.rotationState.deviceLastUsed = new Map();
        }

        // Clear any existing timers
        if (this.campaignTimers.has(campaignId)) {
            clearTimeout(this.campaignTimers.get(campaignId));
            this.campaignTimers.delete(campaignId);
        }

        // Save state
        this.saveCampaigns();

        // Emit restart event
        this.io.to(userId).emit('campaign-restarted', {
            campaignId: campaignId,
            campaignName: campaign.name,
            total: campaign.recipients.length
        });

        // Start processing immediately
        setTimeout(() => {
            this.processCampaign(campaignId);
        }, 1000);

        console.log(`Campaign ${campaignId} restarted by user ${userId}`);
        return true;
    }

    /**
     * Get user campaigns
     */
    getUserCampaigns(userId) {
        const campaignIds = this.userCampaigns.get(userId) || new Set();
        return Array.from(campaignIds).map(id => this.campaigns.get(id)).filter(Boolean);
    }

    /**
     * Clear all campaigns for a specific user
     */
    clearUserCampaigns(userId) {
        const userCampaignIds = this.userCampaigns.get(userId) || new Set();
        
        // Delete each campaign
        userCampaignIds.forEach(campaignId => {
            // Clear any timers
            if (this.campaignTimers.has(campaignId)) {
                clearTimeout(this.campaignTimers.get(campaignId));
                this.campaignTimers.delete(campaignId);
            }
            
            // Remove campaign
            this.campaigns.delete(campaignId);
        });
        
        // Clear user's campaign list
        this.userCampaigns.delete(userId);
        
        // Also clear user messages
        this.clearUserMessages(userId);
        
        // Save to disk
        this.saveCampaigns();
        
        console.log(`Cleared all campaigns and messages for user: ${userId}`);
    }

    /**
     * Load campaigns from disk
     */
    loadCampaigns() {
        try {
            if (fs.existsSync(this.campaignsFilePath)) {
                const data = fs.readFileSync(this.campaignsFilePath, 'utf8');
                const savedCampaigns = JSON.parse(data);
                
                for (const campaignData of savedCampaigns) {
                    // Ensure rotationState exists
                    if (!campaignData.rotationState) {
                        campaignData.rotationState = {
                            strategy: campaignData.options?.rotationStrategy || 'round-robin',
                            deviceIndex: 0,
                            deviceUsage: new Map(),
                            deviceLastUsed: new Map(),
                            currentDeviceMessageCount: 0,
                            currentDevice: null
                        };
                    }
                    
                    // Restore Maps from serialized data
                    if (campaignData.rotationState.deviceUsage) {
                        if (typeof campaignData.rotationState.deviceUsage === 'object' && !Array.isArray(campaignData.rotationState.deviceUsage)) {
                            campaignData.rotationState.deviceUsage = new Map(Object.entries(campaignData.rotationState.deviceUsage));
                        } else {
                            campaignData.rotationState.deviceUsage = new Map();
                        }
                    } else {
                        campaignData.rotationState.deviceUsage = new Map();
                    }
                    
                    if (campaignData.rotationState.deviceLastUsed) {
                        if (typeof campaignData.rotationState.deviceLastUsed === 'object' && !Array.isArray(campaignData.rotationState.deviceLastUsed)) {
                            campaignData.rotationState.deviceLastUsed = new Map(Object.entries(campaignData.rotationState.deviceLastUsed));
                        } else {
                            campaignData.rotationState.deviceLastUsed = new Map();
                        }
                    } else {
                        campaignData.rotationState.deviceLastUsed = new Map();
                    }
                    
                    this.campaigns.set(campaignData.id, campaignData);
                    
                    // Rebuild user campaigns mapping
                    if (!this.userCampaigns.has(campaignData.userId)) {
                        this.userCampaigns.set(campaignData.userId, new Set());
                    }
                    this.userCampaigns.get(campaignData.userId).add(campaignData.id);
                }
                
                console.log(`Loaded ${savedCampaigns.length} campaigns from disk`);
            }
        } catch (error) {
            console.error('Error loading campaigns:', error);
            // Clear corrupted data
            this.campaigns.clear();
            this.userCampaigns.clear();
        }
    }

    /**
     * Save campaigns to disk
     */
    saveCampaigns() {
        try {
            const campaignsToSave = Array.from(this.campaigns.values()).map(campaign => {
                // Convert Maps to objects for serialization
                const serialized = { ...campaign };
                
                // Ensure rotationState exists
                if (!serialized.rotationState) {
                    serialized.rotationState = {
                        strategy: campaign.options?.rotationStrategy || 'round-robin',
                        deviceIndex: 0,
                        deviceUsage: {},
                        deviceLastUsed: {},
                        currentDeviceMessageCount: 0,
                        currentDevice: null
                    };
                } else {
                    // Convert Maps to objects for JSON serialization
                    if (serialized.rotationState.deviceUsage instanceof Map) {
                        serialized.rotationState.deviceUsage = Object.fromEntries(serialized.rotationState.deviceUsage);
                    } else if (!serialized.rotationState.deviceUsage) {
                        serialized.rotationState.deviceUsage = {};
                    }
                    
                    if (serialized.rotationState.deviceLastUsed instanceof Map) {
                        serialized.rotationState.deviceLastUsed = Object.fromEntries(serialized.rotationState.deviceLastUsed);
                    } else if (!serialized.rotationState.deviceLastUsed) {
                        serialized.rotationState.deviceLastUsed = {};
                    }
                }
                
                return serialized;
            });
            
            fs.writeFileSync(this.campaignsFilePath, JSON.stringify(campaignsToSave, null, 2));
        } catch (error) {
            console.error('Error saving campaigns:', error);
        }
    }

    /**
     * Personalize message with recipient data
     */
    personalizeMessage(message, recipient) {
        let personalizedMessage = message;
        
        // Replace variables with recipient data
        personalizedMessage = personalizedMessage.replace(/\{name\}/g, recipient.name || recipient.phoneNumber);
        personalizedMessage = personalizedMessage.replace(/\{city\}/g, recipient.city || '');
        personalizedMessage = personalizedMessage.replace(/\{order\}/g, recipient.order || '');
        personalizedMessage = personalizedMessage.replace(/\{mobile\}/g, recipient.phoneNumber || '');
        
        return personalizedMessage;
    }

    /**
     * Start campaign recovery service
     */
    startCampaignRecovery() {
        console.log('Starting campaign recovery service...');
        
        // Check for active campaigns that need recovery
        for (const campaign of this.campaigns.values()) {
            if (campaign.status === 'active' && campaign.progress.currentIndex < campaign.recipients.length) {
                console.log(`Recovering campaign ${campaign.id}: ${campaign.progress.currentIndex}/${campaign.recipients.length}`);
                
                // Resume processing after a short delay
                setTimeout(() => {
                    this.processCampaign(campaign.id);
                }, 5000);
            }
        }
    }
}

module.exports = CampaignManager;