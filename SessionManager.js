const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

class SessionManager {
    constructor(io) {
        this.io = io;
        this.sessions = new Map();
        this.sessionTimeouts = new Map();
        this.SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
        
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
     * Create a new WhatsApp session
     */
    async createSession(sessionId) {
        try {
            // Check if session already exists
            if (this.sessions.has(sessionId)) {
                const existingSession = this.sessions.get(sessionId);
                
                // Reset timeout for existing session
                this.resetSessionTimeout(sessionId);
                
                return existingSession;
            }

            console.log(`Creating new session: ${sessionId}`);

            // Detect Chrome executable path based on operating system
            let chromeExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
            
            if (!chromeExecutable) {
                const os = require('os');
                const fs = require('fs');
                const platform = os.platform();
                
                console.log(`[SessionManager] Detecting Chrome for platform: ${platform}`);
                
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
                        chromeExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
                        break;
                    case 'linux':
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
                    console.log(`✅ [SessionManager] Chrome found at: ${chromeExecutable}`);
                } else {
                    console.log(`⚠️  [SessionManager] Chrome not found, will use Puppeteer's bundled Chromium`);
                    chromeExecutable = undefined;
                }
            }

            // Create WhatsApp client with enhanced configuration for server environments
            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: sessionId,
                    dataPath: '.wwebjs_auth'
                }),
                puppeteer: {
                    headless: true,
                    executablePath: chromeExecutable,
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
                        '--allow-running-insecure-content',
                        '--disable-blink-features=AutomationControlled',
                        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    ],
                    timeout: 120000,
                    handleSIGINT: false,
                    handleSIGTERM: false,
                    handleSIGHUP: false,
                    ignoreDefaultArgs: ['--disable-extensions'],
                    slowMo: 100
                },
                qrMaxRetries: 10,
                takeoverOnConflict: true,
                takeoverTimeoutMs: 120000,
                restartOnAuthFail: true
            });

            // Create session object
            const session = {
                id: sessionId,
                client: client,
                status: 'initializing',
                isReady: false,
                qrCode: null,
                createdAt: new Date(),
                lastActivity: new Date()
            };

            // Store session
            this.sessions.set(sessionId, session);

            // Set up event handlers
            this.setupClientEvents(sessionId, client);

            // Initialize client
            await client.initialize();

            // Set session timeout
            this.resetSessionTimeout(sessionId);

            return session;

        } catch (error) {
            console.error(`Error creating session ${sessionId}:`, error);
            
            // Clean up failed session
            if (this.sessions.has(sessionId)) {
                await this.deleteSession(sessionId);
            }
            
            throw error;
        }
    }

    /**
     * Set up event handlers for WhatsApp client
     */
    setupClientEvents(sessionId, client) {
        // QR Code event - Enhanced for faster and more reliable QR generation
        client.on('qr', async (qr) => {
            try {
                console.log(`QR code generated for session ${sessionId} (Length: ${qr.length})`);
                
                // Generate QR code image with fast settings
                const qrCodeDataUrl = await QRCode.toDataURL(qr, {
                    width: 300,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    },
                    errorCorrectionLevel: 'M',
                    type: 'image/png'
                });

                // Update session immediately
                const session = this.sessions.get(sessionId);
                if (session) {
                    session.status = 'waiting-for-qr-scan';
                    session.qrCode = qrCodeDataUrl;
                    session.lastActivity = new Date();
                    session.qrGeneratedAt = new Date();
                }

                console.log(`QR code successfully generated for session ${sessionId}`);

                // Emit QR code to session room immediately
                this.io.to(sessionId).emit('qr-code', {
                    sessionId: sessionId,
                    qrCode: qrCodeDataUrl,
                    message: 'Scan this QR code with your WhatsApp mobile app',
                    timestamp: new Date()
                });

                // Update session status
                this.io.to(sessionId).emit('session-status', {
                    sessionId: sessionId,
                    status: 'waiting-for-qr-scan',
                    isReady: false,
                    hasQR: true
                });

                // Set QR refresh timer
                setTimeout(() => {
                    const currentSession = this.sessions.get(sessionId);
                    if (currentSession && currentSession.status === 'waiting-for-qr-scan') {
                        console.log(`QR code expired for session ${sessionId}, will generate new one`);
                        currentSession.qrCode = null;
                        this.io.to(sessionId).emit('qr-expired', {
                            sessionId: sessionId,
                            message: 'QR code expired, new one will be generated automatically'
                        });
                    }
                }, 25000);

            } catch (error) {
                console.error(`Error generating QR code for session ${sessionId}:`, error);
                this.io.to(sessionId).emit('error', {
                    sessionId: sessionId,
                    message: 'Failed to generate QR code: ' + error.message,
                    error: error.message,
                    canRetry: true
                });
            }
        });

        // Ready event
        client.on('ready', () => {
            console.log(`WhatsApp client ready for session ${sessionId}`);
            
            const session = this.sessions.get(sessionId);
            if (session) {
                session.status = 'ready';
                session.isReady = true;
                session.qrCode = null;
                session.lastActivity = new Date();
            }

            // Emit ready status
            this.io.to(sessionId).emit('session-ready', {
                sessionId: sessionId,
                message: 'WhatsApp session is ready! You can now send messages.'
            });

            this.io.to(sessionId).emit('session-status', {
                sessionId: sessionId,
                status: 'ready',
                isReady: true
            });
        });

        // Authenticated event
        client.on('authenticated', () => {
            console.log(`WhatsApp client authenticated for session ${sessionId}`);
            
            const session = this.sessions.get(sessionId);
            if (session) {
                session.status = 'authenticated';
                session.lastActivity = new Date();
            }

            this.io.to(sessionId).emit('session-status', {
                sessionId: sessionId,
                status: 'authenticated',
                isReady: false
            });
        });

        // Authentication failure
        client.on('auth_failure', (message) => {
            console.error(`Authentication failed for session ${sessionId}:`, message);
            
            const session = this.sessions.get(sessionId);
            if (session) {
                session.status = 'auth-failed';
                session.isReady = false;
            }

            this.io.to(sessionId).emit('auth-failure', {
                sessionId: sessionId,
                message: 'Authentication failed. Please try scanning the QR code again.',
                error: message
            });

            this.io.to(sessionId).emit('session-status', {
                sessionId: sessionId,
                status: 'auth-failed',
                isReady: false
            });
        });

        // Disconnected event
        client.on('disconnected', (reason) => {
            console.log(`WhatsApp client disconnected for session ${sessionId}:`, reason);
            
            const session = this.sessions.get(sessionId);
            if (session) {
                session.status = 'disconnected';
                session.isReady = false;
            }

            this.io.to(sessionId).emit('session-disconnected', {
                sessionId: sessionId,
                message: 'WhatsApp session disconnected',
                reason: reason
            });

            this.io.to(sessionId).emit('session-status', {
                sessionId: sessionId,
                status: 'disconnected',
                isReady: false
            });

            // Auto cleanup disconnected session after delay
            setTimeout(() => {
                this.deleteSession(sessionId);
            }, 5000);
        });

        // Message event (optional - for logging incoming messages)
        client.on('message', (message) => {
            const session = this.sessions.get(sessionId);
            if (session) {
                session.lastActivity = new Date();
            }
        });

        // Error event
        client.on('error', (error) => {
            console.error(`WhatsApp client error for session ${sessionId}:`, error);
            
            this.io.to(sessionId).emit('error', {
                sessionId: sessionId,
                message: 'WhatsApp client error occurred',
                error: error.message
            });
        });
    }

    /**
     * Get session by ID
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId) || null;
    }

    /**
     * Delete session and cleanup resources
     */
    async deleteSession(sessionId) {
        try {
            console.log(`Deleting session: ${sessionId}`);
            
            const session = this.sessions.get(sessionId);
            if (session && session.client) {
                try {
                    // Check if client is initialized before destroying
                    if (session.client.pupPage) {
                        await session.client.destroy();
                    }
                } catch (destroyError) {
                    console.warn(`Warning during client destroy for ${sessionId}:`, destroyError.message);
                }
            }

            // Remove from sessions map
            this.sessions.delete(sessionId);

            // Clear timeout
            if (this.sessionTimeouts.has(sessionId)) {
                clearTimeout(this.sessionTimeouts.get(sessionId));
                this.sessionTimeouts.delete(sessionId);
            }

            // Clean up auth directory for this session
            const sessionAuthDir = path.join(__dirname, '.wwebjs_auth', `session-${sessionId}`);
            if (fs.existsSync(sessionAuthDir)) {
                this.removeDirectory(sessionAuthDir);
            }

            console.log(`Session ${sessionId} deleted successfully`);

        } catch (error) {
            console.error(`Error deleting session ${sessionId}:`, error);
            // Still remove from sessions map even if cleanup failed
            this.sessions.delete(sessionId);
            if (this.sessionTimeouts.has(sessionId)) {
                clearTimeout(this.sessionTimeouts.get(sessionId));
                this.sessionTimeouts.delete(sessionId);
            }
            throw error;
        }
    }

    /**
     * Reset session timeout
     */
    resetSessionTimeout(sessionId) {
        // Clear existing timeout
        if (this.sessionTimeouts.has(sessionId)) {
            clearTimeout(this.sessionTimeouts.get(sessionId));
        }

        // Set new timeout
        const timeout = setTimeout(async () => {
            console.log(`Session ${sessionId} timed out, cleaning up...`);
            await this.deleteSession(sessionId);
        }, this.SESSION_TIMEOUT);

        this.sessionTimeouts.set(sessionId, timeout);
    }

    /**
     * Get all active sessions
     */
    getAllSessions() {
        return Array.from(this.sessions.values());
    }

    /**
     * Get session count
     */
    getSessionCount() {
        return this.sessions.size;
    }

    /**
     * Start cleanup interval for inactive sessions
     */
    startCleanupInterval() {
        setInterval(async () => {
            const now = new Date();
            const inactiveSessions = [];

            for (const [sessionId, session] of this.sessions) {
                const timeDiff = now - session.lastActivity;
                
                // Mark sessions inactive after 1 hour of no activity
                if (timeDiff > (60 * 60 * 1000)) {
                    inactiveSessions.push(sessionId);
                }
            }

            // Clean up inactive sessions
            for (const sessionId of inactiveSessions) {
                console.log(`Cleaning up inactive session: ${sessionId}`);
                await this.deleteSession(sessionId);
            }

            // Log session stats
            if (this.sessions.size > 0) {
                console.log(`Active sessions: ${this.sessions.size}`);
            }

        }, 10 * 60 * 1000); // Check every 10 minutes
    }

    /**
     * Cleanup all sessions
     */
    async cleanup() {
        console.log('Cleaning up all sessions...');
        
        const sessionIds = Array.from(this.sessions.keys());
        
        for (const sessionId of sessionIds) {
            try {
                await this.deleteSession(sessionId);
            } catch (error) {
                console.error(`Error cleaning up session ${sessionId}:`, error);
                // Continue with other sessions even if one fails
            }
        }

        // Clear all timeouts
        for (const timeout of this.sessionTimeouts.values()) {
            clearTimeout(timeout);
        }
        this.sessionTimeouts.clear();

        console.log('All sessions cleaned up');
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
     * Update session activity
     */
    updateActivity(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.lastActivity = new Date();
            this.resetSessionTimeout(sessionId);
        }
    }
}

module.exports = SessionManager;