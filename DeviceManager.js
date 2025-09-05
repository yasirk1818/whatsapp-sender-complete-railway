const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class DeviceManager {
    constructor(io) {
        this.io = io;
        this.devices = new Map(); // Map<deviceId, device>
        this.userDevices = new Map(); // Map<userId, Set<deviceId>>
        this.deviceTimeouts = new Map();
        this.messageQueue = new Map(); // Map<deviceId, Array<message>>
        this.DEVICE_TIMEOUT = 60 * 60 * 1000; // 1 hour
        
        // Ensure auth directory exists
        this.ensureAuthDirectory();
        
        // Start cleanup interval
        this.startCleanupInterval();
    }

    /**
     * Ensure the authentication directory exists
     */
    ensureAuthDirectory() {
        const authDir = path.join(__dirname, '.wwebjs_auth');
        if (!fs.existsSync(authDir)) {
            fs.mkdirSync(authDir, { recursive: true });
        }
    }

    /**
     * Create a new WhatsApp device
     */
    async createDevice(userId, deviceName = 'WhatsApp Device') {
        try {
            const deviceId = uuidv4();
            
            console.log(`Creating new device: ${deviceId} for user: ${userId}`);

            // Detect Chrome executable path based on operating system
            let chromeExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
            
            if (!chromeExecutable) {
                const os = require('os');
                const fs = require('fs');
                const platform = os.platform();
                
                console.log(`Detecting Chrome for platform: ${platform}`);
                
                switch (platform) {
                    case 'win32':
                        // Windows paths
                        const windowsPaths = [
                            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                            process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
                        ];
                        for (const path of windowsPaths) {
                            if (fs.existsSync(path)) {
                                chromeExecutable = path;
                                break;
                            }
                        }
                        break;
                    case 'darwin':
                        // macOS path
                        chromeExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
                        break;
                    case 'linux':
                        // Linux paths
                        const linuxPaths = [
                            '/usr/bin/google-chrome-stable',
                            '/usr/bin/google-chrome',
                            '/usr/bin/chromium-browser',
                            '/usr/bin/chromium'
                        ];
                        for (const path of linuxPaths) {
                            if (fs.existsSync(path)) {
                                chromeExecutable = path;
                                break;
                            }
                        }
                        break;
                }
                
                if (chromeExecutable) {
                    console.log(`✅ Chrome found at: ${chromeExecutable}`);
                } else {
                    console.log(`⚠️  Chrome not found, will use Puppeteer's bundled Chromium`);
                    chromeExecutable = undefined; // Let Puppeteer use bundled Chromium
                }
            }

            // Create WhatsApp client with optimized settings for server environments
            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: deviceId,
                    dataPath: '.wwebjs_auth'
                }),
                puppeteer: {
                    headless: true,
                    executablePath: chromeExecutable, // Use detected path or let Puppeteer use bundled Chromium
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu',
                        '--disable-web-security',
                        '--disable-features=VizDisplayCompositor,AudioServiceOutOfProcess',
                        '--disable-background-timer-throttling',
                        '--disable-backgrounding-occluded-windows',
                        '--disable-renderer-backgrounding',
                        '--disable-extensions',
                        '--disable-plugins',
                        '--disable-default-apps',
                        '--disable-ipc-flooding-protection',
                        '--disable-hang-monitor',
                        '--disable-prompt-on-repost',
                        '--disable-client-side-phishing-detection',
                        '--disable-sync',
                        '--disable-background-networking',
                        '--disable-software-rasterizer',
                        '--disable-features=TranslateUI',
                        '--disable-crash-reporter',
                        '--disable-component-extensions-with-background-pages',
                        '--no-default-browser-check',
                        '--mute-audio',
                        '--disable-logging',
                        '--disable-notifications',
                        '--disable-permissions-api',
                        '--disable-web-security',
                        '--allow-running-insecure-content',
                        '--disable-blink-features=AutomationControlled',
                        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    ],
                    timeout: 120000, // Increased timeout for server environments
                    handleSIGINT: false,
                    handleSIGTERM: false,
                    handleSIGHUP: false,
                    ignoreDefaultArgs: ['--disable-extensions'],
                    slowMo: 100 // Add slight delay to prevent crashes
                },
                qrMaxRetries: 10, // Increased retries for server environments
                takeoverOnConflict: true,
                takeoverTimeoutMs: 120000, // Increased timeout
                restartOnAuthFail: true
            });

            // Create device object
            const device = {
                id: deviceId,
                userId: userId,
                name: deviceName,
                client: client,
                status: 'initializing',
                isReady: false,
                qrCode: null,
                createdAt: new Date(),
                lastActivity: new Date(),
                phoneNumber: null,
                info: null
            };

            // Store device
            this.devices.set(deviceId, device);

            // Add to user's devices
            if (!this.userDevices.has(userId)) {
                this.userDevices.set(userId, new Set());
            }
            this.userDevices.get(userId).add(deviceId);

            // Initialize message queue for device
            this.messageQueue.set(deviceId, []);

            // Set up event handlers
            this.setupClientEvents(deviceId, client);

            // Initialize client with retry mechanism
            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries) {
                try {
                    console.log(`Initializing WhatsApp client for device ${deviceId} (attempt ${retryCount + 1}/${maxRetries})`);
                    await client.initialize();
                    console.log(`✅ WhatsApp client initialized successfully for device ${deviceId}`);
                    break;
                } catch (initError) {
                    retryCount++;
                    console.error(`❌ Client initialization failed for device ${deviceId} (attempt ${retryCount}/${maxRetries}):`, initError.message);
                    
                    if (retryCount >= maxRetries) {
                        throw new Error(`Failed to initialize WhatsApp client after ${maxRetries} attempts: ${initError.message}`);
                    }
                    
                    // Wait before retry with exponential backoff
                    const delay = Math.min(5000 * Math.pow(2, retryCount - 1), 30000);
                    console.log(`⏳ Retrying in ${delay / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    // Clean up failed client before retry
                    try {
                        await client.destroy();
                    } catch (destroyError) {
                        console.log(`Warning: Could not destroy failed client:`, destroyError.message);
                    }
                    
                    // Create new client for retry
                    if (retryCount < maxRetries) {
                        console.log(`Creating new client for retry ${retryCount + 1}`);
                        // Note: We continue with the same client object but it will be reinitialized
                    }
                }
            }

            // Set device timeout
            this.resetDeviceTimeout(deviceId);

            return device;

        } catch (error) {
            console.error(`Error creating device for user ${userId}:`, error);
            
            // Clean up failed device (deviceId might not be defined if error occurred early)
            if (typeof deviceId !== 'undefined' && this.devices.has(deviceId)) {
                await this.deleteDevice(deviceId);
            }
            
            throw error;
        }
    }

    /**
     * Set up event handlers for WhatsApp client
     */
    setupClientEvents(deviceId, client) {
        const device = this.devices.get(deviceId);
        if (!device) return;

        // QR Code event - Enhanced with better error handling and retry logic
        client.on('qr', async (qr) => {
            try {
                console.log(`QR code generated for device ${deviceId} (Length: ${qr.length})`);
                
                // Generate QR code image with optimized settings for fast generation
                const qrCodeDataUrl = await QRCode.toDataURL(qr, {
                    width: 256,
                    margin: 1,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    },
                    errorCorrectionLevel: 'M',
                    type: 'image/png'
                });

                // Update device immediately
                device.status = 'waiting-for-qr-scan';
                device.qrCode = qrCodeDataUrl;
                device.lastActivity = new Date();
                device.qrGeneratedAt = new Date();

                console.log(`QR code successfully generated for device ${deviceId}`);

                // Emit QR code to user immediately
                this.io.to(device.userId).emit('device-qr-code', {
                    deviceId: deviceId,
                    qrCode: qrCodeDataUrl,
                    message: 'QR code ready for scanning',
                    timestamp: device.qrGeneratedAt
                });

                // Update device status
                this.io.to(device.userId).emit('device-status', {
                    deviceId: deviceId,
                    status: 'waiting-for-qr-scan',
                    isReady: false,
                    hasQR: true
                });

                // Set QR expiry timer (WhatsApp QR codes typically expire after 30 seconds)
                setTimeout(() => {
                    if (device.status === 'waiting-for-qr-scan') {
                        console.log(`QR code expired for device ${deviceId}, requesting new one`);
                        device.qrCode = null;
                        this.io.to(device.userId).emit('device-qr-expired', {
                            deviceId: deviceId,
                            message: 'QR code expired, generating new one...'
                        });
                    }
                }, 25000); // Refresh before WhatsApp's 30-second expiry

            } catch (error) {
                console.error(`Error generating QR code for device ${deviceId}:`, error);
                
                // Update device status to show error
                device.status = 'qr-error';
                
                this.io.to(device.userId).emit('device-error', {
                    deviceId: deviceId,
                    message: 'Failed to generate QR code',
                    error: error.message,
                    canRetry: true
                });
                
                // Retry QR generation after a delay
                setTimeout(async () => {
                    try {
                        console.log(`Retrying QR generation for device ${deviceId}`);
                        await client.destroy();
                        await this.createDevice(device.userId, device.name);
                    } catch (retryError) {
                        console.error(`QR retry failed for device ${deviceId}:`, retryError);
                    }
                }, 5000);
            }
        });

        // Ready event
        client.on('ready', async () => {
            console.log(`WhatsApp client ready for device ${deviceId}`);
            
            try {
                // Get device info
                const info = client.info;
                device.status = 'ready';
                device.isReady = true;
                device.qrCode = null;
                device.lastActivity = new Date();
                device.phoneNumber = info.wid.user;
                device.info = info;

                // Emit ready status
                this.io.to(device.userId).emit('device-ready', {
                    deviceId: deviceId,
                    message: 'WhatsApp device is ready!',
                    phoneNumber: device.phoneNumber,
                    info: device.info
                });

                this.io.to(device.userId).emit('device-status', {
                    deviceId: deviceId,
                    status: 'ready',
                    isReady: true,
                    phoneNumber: device.phoneNumber
                });
            } catch (error) {
                console.error(`Error getting device info for ${deviceId}:`, error);
            }
        });

        // Authenticated event
        client.on('authenticated', () => {
            console.log(`WhatsApp client authenticated for device ${deviceId}`);
            
            device.status = 'authenticated';
            device.lastActivity = new Date();

            this.io.to(device.userId).emit('device-status', {
                deviceId: deviceId,
                status: 'authenticated',
                isReady: false
            });
        });

        // Authentication failure
        client.on('auth_failure', (message) => {
            console.error(`Authentication failed for device ${deviceId}:`, message);
            
            device.status = 'auth-failed';
            device.isReady = false;

            this.io.to(device.userId).emit('device-auth-failure', {
                deviceId: deviceId,
                message: 'Authentication failed. Please try scanning the QR code again.',
                error: message
            });

            this.io.to(device.userId).emit('device-status', {
                deviceId: deviceId,
                status: 'auth-failed',
                isReady: false
            });
        });

        // Disconnected event
        client.on('disconnected', (reason) => {
            console.log(`WhatsApp client disconnected for device ${deviceId}:`, reason);
            
            device.status = 'disconnected';
            device.isReady = false;

            this.io.to(device.userId).emit('device-disconnected', {
                deviceId: deviceId,
                message: 'WhatsApp device disconnected',
                reason: reason
            });

            this.io.to(device.userId).emit('device-status', {
                deviceId: deviceId,
                status: 'disconnected',
                isReady: false
            });

            // Auto cleanup disconnected device after delay
            setTimeout(() => {
                this.deleteDevice(deviceId);
            }, 10000);
        });

        // Error event - Enhanced error handling
        client.on('error', (error) => {
            console.error(`WhatsApp client error for device ${deviceId}:`, error);
            
            // Update device status
            device.status = 'error';
            device.isReady = false;
            
            // Determine error type and appropriate response
            let errorMessage = 'WhatsApp client error occurred';
            let canRetry = true;
            
            if (error.message.includes('Session closed') || error.message.includes('Target closed')) {
                errorMessage = 'Browser session was closed unexpectedly';
                canRetry = true;
            } else if (error.message.includes('Navigation timeout') || error.message.includes('Timeout')) {
                errorMessage = 'Connection timeout - please check your internet connection';
                canRetry = true;
            } else if (error.message.includes('Protocol error')) {
                errorMessage = 'Browser protocol error - this may be a temporary issue';
                canRetry = true;
            }
            
            this.io.to(device.userId).emit('device-error', {
                deviceId: deviceId,
                message: errorMessage,
                error: error.message,
                canRetry: canRetry,
                timestamp: new Date()
            });
            
            this.io.to(device.userId).emit('device-status', {
                deviceId: deviceId,
                status: 'error',
                isReady: false,
                error: error.message
            });
            
            // Auto-retry for certain types of errors
            if (canRetry && (error.message.includes('Target closed') || error.message.includes('Session closed'))) {
                console.log(`Auto-retrying device ${deviceId} due to recoverable error`);
                setTimeout(async () => {
                    try {
                        console.log(`Attempting to recreate device ${deviceId} after error`);
                        await this.deleteDevice(deviceId);
                        await this.createDevice(device.userId, device.name);
                    } catch (retryError) {
                        console.error(`Auto-retry failed for device ${deviceId}:`, retryError);
                    }
                }, 10000); // Wait 10 seconds before retry
            }
        });
    }

    /**
     * Get device by ID
     */
    getDevice(deviceId) {
        return this.devices.get(deviceId) || null;
    }

    /**
     * Force QR generation for a device (if it's stuck)
     */
    async forceQRGeneration(deviceId) {
        const device = this.devices.get(deviceId);
        if (!device) {
            throw new Error('Device not found');
        }

        try {
            console.log(`Forcing QR generation for device ${deviceId}`);
            
            // If device is stuck in initializing state, restart it
            if (device.status === 'initializing' || device.status === 'pending') {
                console.log(`Restarting stuck device ${deviceId}`);
                
                // Destroy old client if exists
                if (device.client) {
                    try {
                        await device.client.destroy();
                    } catch (destroyError) {
                        console.log(`Error destroying client for ${deviceId}:`, destroyError.message);
                    }
                }
                
                // Create new client with the same device ID
                const newDevice = await this.createDevice(device.userId, device.name);
                return newDevice;
            }
            
            // If device has QR, emit it again
            if (device.qrCode) {
                this.io.to(device.userId).emit('device-qr-code', {
                    deviceId: deviceId,
                    qrCode: device.qrCode,
                    message: 'QR code retrieved (cached)',
                    timestamp: device.qrGeneratedAt || new Date()
                });
                return device;
            }
            
            // For other cases, try to restart the client
            if (device.client && typeof device.client.initialize === 'function') {
                await device.client.initialize();
            }
            
            return device;
            
        } catch (error) {
            console.error(`Error forcing QR generation for device ${deviceId}:`, error);
            throw error;
        }
    }

    /**
     * Get all devices for a user
     */
    getUserDevices(userId) {
        const deviceIds = this.userDevices.get(userId) || new Set();
        return Array.from(deviceIds).map(id => this.devices.get(id)).filter(Boolean);
    }

    /**
     * Get ready devices for a user
     */
    getReadyDevices(userId) {
        return this.getUserDevices(userId).filter(device => device.isReady);
    }

    /**
     * Send message using specific device with human-like typing simulation
     */
    async sendMessage(deviceId, phoneNumber, message, attachment = null, options = {}) {
        const device = this.devices.get(deviceId);
        
        if (!device || !device.client || !device.isReady) {
            throw new Error('Device not ready for sending messages');
        }

        // Format phone number
        const formattedNumber = phoneNumber.replace(/\D/g, '');
        const chatId = formattedNumber.includes('@') ? formattedNumber : `${formattedNumber}@c.us`;

        // Get chat for typing simulation
        const chat = await device.client.getChatById(chatId);
        
        try {
            // Human-like typing simulation
            if (options.enableTypingSimulation !== false) {
                console.log(`Starting typing simulation for message to ${phoneNumber}`);
                
                // Start typing
                await chat.sendStateTyping();
                console.log(`✓ Typing status started for ${phoneNumber}`);
                
                // Calculate typing duration based on message length
                const typingDuration = this.calculateTypingDuration(message);
                
                // Add random human-like pause
                const randomPause = this.generateRandomPause();
                const totalDelay = typingDuration + randomPause;
                
                console.log(`Simulating typing for ${totalDelay}ms (${typingDuration}ms typing + ${randomPause}ms pause) for message to ${phoneNumber}`);
                
                // Wait for typing simulation
                await new Promise(resolve => setTimeout(resolve, totalDelay));
                
                // Clear typing state before sending
                await chat.clearState();
                console.log(`✓ Typing status cleared for ${phoneNumber}`);
                
                // Small pause after clearing typing state
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            // Send message
            let result;
            if (attachment) {
                const media = MessageMedia.fromFilePath(attachment.path);
                result = await device.client.sendMessage(chatId, media, { caption: message });
            } else {
                result = await device.client.sendMessage(chatId, message);
            }

            // Update device activity
            device.lastActivity = new Date();
            this.resetDeviceTimeout(deviceId);

            return result;
            
        } catch (error) {
            // Make sure to clear typing state on error
            try {
                await chat.clearState();
            } catch (clearError) {
                console.warn('Failed to clear typing state:', clearError.message);
            }
            throw error;
        }
    }

    /**
     * Send bulk messages using available devices with rotation strategy
     */
    async sendBulkMessages(userId, recipients, message, attachment = null, options = {}) {
        const readyDevices = this.getReadyDevices(userId);
        
        if (readyDevices.length === 0) {
            throw new Error('No ready devices available for bulk messaging');
        }

        // Apply device filtering if specified
        const selectedDevices = options.selectedDevices ? 
            readyDevices.filter(d => options.selectedDevices.includes(d.id)) : 
            readyDevices;
            
        if (selectedDevices.length === 0) {
            throw new Error('No selected devices are ready for messaging');
        }

        const results = [];
        const errors = [];
        const batchId = uuidv4();
        const rotationStrategy = options.rotationStrategy || 'round-robin';
        const delay = options.delay || 2000;
        
        // Initialize rotation state
        const rotationState = {
            deviceIndex: 0,
            deviceUsage: new Map(),
            deviceLastUsed: new Map()
        };
        
        selectedDevices.forEach(device => {
            rotationState.deviceUsage.set(device.id, 0);
            rotationState.deviceLastUsed.set(device.id, 0);
        });

        for (let i = 0; i < recipients.length; i++) {
            const recipient = recipients[i];
            
            // Select device based on rotation strategy
            const device = this.selectDeviceByStrategy(selectedDevices, rotationStrategy, rotationState);
            
            try {
                // Emit progress update
                this.io.to(userId).emit('bulk-message-progress', {
                    batchId: batchId,
                    current: i + 1,
                    total: recipients.length,
                    recipient: recipient.phoneNumber,
                    deviceId: device.id,
                    deviceName: device.name,
                    enableTypingSimulation: options.enableTypingSimulation !== false
                });

                // Send message with typing simulation
                const personalizedMessage = this.personalizeMessage(message, recipient);
                const result = await this.sendMessage(device.id, recipient.phoneNumber, personalizedMessage, attachment, {
                    enableTypingSimulation: options.enableTypingSimulation !== false
                });
                
                // Update rotation state
                this.updateRotationState(rotationState, device.id);
                
                results.push({
                    recipient: recipient,
                    success: true,
                    messageId: result.id._serialized,
                    deviceId: device.id,
                    deviceName: device.name,
                    timestamp: new Date()
                });

                // Emit success for individual message
                this.io.to(userId).emit('bulk-message-sent', {
                    batchId: batchId,
                    recipient: recipient,
                    success: true,
                    deviceId: device.id,
                    deviceName: device.name
                });

            } catch (error) {
                console.error(`Error sending message to ${recipient.phoneNumber}:`, error);
                
                errors.push({
                    recipient: recipient,
                    error: error.message,
                    deviceId: device.id,
                    deviceName: device.name,
                    timestamp: new Date()
                });

                // Emit error for individual message
                this.io.to(userId).emit('bulk-message-error', {
                    batchId: batchId,
                    recipient: recipient,
                    error: error.message,
                    deviceId: device.id,
                    deviceName: device.name
                });
            }

            // Add delay between messages (except for last message)
            if (i < recipients.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // Emit completion with rotation statistics
        this.io.to(userId).emit('bulk-message-complete', {
            batchId: batchId,
            total: recipients.length,
            successful: results.length,
            failed: errors.length,
            results: results,
            errors: errors,
            rotationStats: {
                strategy: rotationStrategy,
                deviceUsage: Object.fromEntries(rotationState.deviceUsage),
                devicesUsed: selectedDevices.length
            }
        });

        return {
            batchId: batchId,
            total: recipients.length,
            successful: results.length,
            failed: errors.length,
            results: results,
            errors: errors,
            rotationStats: {
                strategy: rotationStrategy,
                deviceUsage: Object.fromEntries(rotationState.deviceUsage),
                devicesUsed: selectedDevices.length
            }
        };
    }

    /**
     * Select device based on rotation strategy
     */
    selectDeviceByStrategy(devices, strategy, rotationState) {
        switch (strategy) {
            case 'round-robin':
                return this.selectRoundRobin(devices, rotationState);
                
            case 'random':
                return this.selectRandom(devices);
                
            case 'load-balanced':
                return this.selectLoadBalanced(devices, rotationState);
                
            case 'manual':
            default:
                return this.selectRoundRobin(devices, rotationState);
        }
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
     * Load-balanced device selection (least used device)
     */
    selectLoadBalanced(devices, rotationState) {
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
    updateRotationState(rotationState, deviceId) {
        const currentUsage = rotationState.deviceUsage.get(deviceId) || 0;
        rotationState.deviceUsage.set(deviceId, currentUsage + 1);
        rotationState.deviceLastUsed.set(deviceId, Date.now());
    }

    /**
     * Calculate realistic typing duration based on message length
     */
    calculateTypingDuration(message) {
        // Average human typing speed: 40 words per minute = 200 characters per minute
        // That's about 3.33 characters per second, or 300ms per character
        const baseTypingSpeed = 300; // milliseconds per character
        
        // Add variability for more realistic typing
        const variabilityFactor = 0.5 + Math.random(); // 0.5x to 1.5x speed
        
        // Calculate duration based on message length
        const messageLength = message.length;
        const baseDuration = messageLength * baseTypingSpeed * variabilityFactor;
        
        // Minimum 1 second, maximum 15 seconds for very long messages
        return Math.min(Math.max(baseDuration, 1000), 15000);
    }
    
    /**
     * Generate random pause to simulate natural human behavior
     */
    generateRandomPause() {
        // Random pause between 500ms to 3000ms
        const minPause = 500;
        const maxPause = 3000;
        
        // Add occasional longer pauses (like thinking)
        const isLongPause = Math.random() < 0.2; // 20% chance
        
        if (isLongPause) {
            // Longer pause: 2-8 seconds
            return Math.random() * 6000 + 2000;
        } else {
            // Normal pause
            return Math.random() * (maxPause - minPause) + minPause;
        }
    }

    /**
     * Delete device and cleanup resources
     */
    async deleteDevice(deviceId) {
        try {
            console.log(`Deleting device: ${deviceId}`);
            
            const device = this.devices.get(deviceId);
            if (device) {
                // Remove from user's device list
                if (this.userDevices.has(device.userId)) {
                    this.userDevices.get(device.userId).delete(deviceId);
                    if (this.userDevices.get(device.userId).size === 0) {
                        this.userDevices.delete(device.userId);
                    }
                }

                // Destroy WhatsApp client
                if (device.client) {
                    try {
                        if (device.client.pupPage) {
                            await device.client.destroy();
                        }
                    } catch (destroyError) {
                        console.warn(`Warning during client destroy for ${deviceId}:`, destroyError.message);
                    }
                }
            }

            // Remove from devices map
            this.devices.delete(deviceId);

            // Clear timeout
            if (this.deviceTimeouts.has(deviceId)) {
                clearTimeout(this.deviceTimeouts.get(deviceId));
                this.deviceTimeouts.delete(deviceId);
            }

            // Clear message queue
            this.messageQueue.delete(deviceId);

            // Clean up auth directory for this device
            const deviceAuthDir = path.join(__dirname, '.wwebjs_auth', `session-${deviceId}`);
            if (fs.existsSync(deviceAuthDir)) {
                this.removeDirectory(deviceAuthDir);
            }

            console.log(`Device ${deviceId} deleted successfully`);

        } catch (error) {
            console.error(`Error deleting device ${deviceId}:`, error);
            // Still remove from maps even if cleanup failed
            const device = this.devices.get(deviceId);
            if (device && this.userDevices.has(device.userId)) {
                this.userDevices.get(device.userId).delete(deviceId);
            }
            this.devices.delete(deviceId);
            this.messageQueue.delete(deviceId);
            if (this.deviceTimeouts.has(deviceId)) {
                clearTimeout(this.deviceTimeouts.get(deviceId));
                this.deviceTimeouts.delete(deviceId);
            }
        }
    }

    /**
     * Reset device timeout
     */
    resetDeviceTimeout(deviceId) {
        // Clear existing timeout
        if (this.deviceTimeouts.has(deviceId)) {
            clearTimeout(this.deviceTimeouts.get(deviceId));
        }

        // Set new timeout
        const timeout = setTimeout(async () => {
            console.log(`Device ${deviceId} timed out, cleaning up...`);
            await this.deleteDevice(deviceId);
        }, this.DEVICE_TIMEOUT);

        this.deviceTimeouts.set(deviceId, timeout);
    }

    /**
     * Start cleanup interval for inactive devices
     */
    startCleanupInterval() {
        setInterval(async () => {
            const now = new Date();
            const inactiveDevices = [];

            for (const [deviceId, device] of this.devices) {
                const timeDiff = now - device.lastActivity;
                
                // Mark devices inactive after 2 hours of no activity
                if (timeDiff > (2 * 60 * 60 * 1000)) {
                    inactiveDevices.push(deviceId);
                }
            }

            // Clean up inactive devices
            for (const deviceId of inactiveDevices) {
                console.log(`Cleaning up inactive device: ${deviceId}`);
                await this.deleteDevice(deviceId);
            }

            // Log device stats
            if (this.devices.size > 0) {
                console.log(`Active devices: ${this.devices.size}`);
            }

        }, 15 * 60 * 1000); // Check every 15 minutes
    }

    /**
     * Cleanup all devices
     */
    async cleanup() {
        console.log('Cleaning up all devices...');
        
        const deviceIds = Array.from(this.devices.keys());
        
        for (const deviceId of deviceIds) {
            try {
                await this.deleteDevice(deviceId);
            } catch (error) {
                console.error(`Error cleaning up device ${deviceId}:`, error);
            }
        }

        // Clear all timeouts
        for (const timeout of this.deviceTimeouts.values()) {
            clearTimeout(timeout);
        }
        this.deviceTimeouts.clear();

        console.log('All devices cleaned up');
    }

    /**
     * Remove directory recursively
     */
    removeDirectory(dirPath) {
        try {
            if (fs.existsSync(dirPath)) {
                const files = fs.readdirSync(dirPath);
                
                for (const file of files) {
                    const filePath = path.join(dirPath, file);
                    const stat = fs.statSync(filePath);
                    
                    if (stat.isDirectory()) {
                        this.removeDirectory(filePath);
                    } else {
                        fs.unlinkSync(filePath);
                    }
                }
                
                fs.rmdirSync(dirPath);
            }
        } catch (error) {
            console.error(`Error removing directory ${dirPath}:`, error);
        }
    }

    /**
     * Update device activity
     */
    updateActivity(deviceId) {
        const device = this.devices.get(deviceId);
        if (device) {
            device.lastActivity = new Date();
            this.resetDeviceTimeout(deviceId);
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
     * Get device statistics
     */
    getDeviceStats(userId = null) {
        if (userId) {
            const userDevices = this.getUserDevices(userId);
            return {
                total: userDevices.length,
                ready: userDevices.filter(d => d.isReady).length,
                connecting: userDevices.filter(d => d.status === 'waiting-for-qr-scan' || d.status === 'authenticated').length,
                disconnected: userDevices.filter(d => d.status === 'disconnected').length
            };
        }

        return {
            total: this.devices.size,
            ready: Array.from(this.devices.values()).filter(d => d.isReady).length,
            users: this.userDevices.size
        };
    }
}

module.exports = DeviceManager;