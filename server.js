const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const DeviceManager = require('./DeviceManager');
const SessionManager = require('./SessionManager');
const CampaignManager = require('./CampaignManager');
const WhatsAppAPI = require('./WhatsAppAPI');
const database = require('./config/database'); // Keep for backward compatibility but won't be used
const authService = require('./config/auth');

// Initialize Express app and server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Initialize managers
const deviceManager = new DeviceManager(io);
const sessionManager = new SessionManager(io); // Keep for backward compatibility
const campaignManager = new CampaignManager(io, deviceManager);
const whatsappAPI = new WhatsAppAPI(io, sessionManager, deviceManager); // API functionality disabled

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'whatsapp-sender-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true in production with HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        cb(null, `${timestamp}_${file.originalname}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow common file types + CSV
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|mp3|mp4|avi|mov|csv/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        
        // Also check MIME type for CSV files
        const allowedMimeTypes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
            'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'text/csv', 'application/csv',
            'audio/mpeg', 'audio/mp3',
            'video/mp4', 'video/avi', 'video/quicktime'
        ];
        
        const mimetypeAllowed = allowedMimeTypes.includes(file.mimetype) || file.mimetype.includes('csv');
        
        console.log('File upload check:', {
            filename: file.originalname,
            mimetype: file.mimetype,
            extname: path.extname(file.originalname).toLowerCase(),
            extnameAllowed: extname,
            mimetypeAllowed: mimetypeAllowed
        });

        if (mimetypeAllowed || extname) {
            return cb(null, true);
        } else {
            console.error('File rejected:', file.originalname, file.mimetype);
            cb(new Error(`Invalid file type: ${file.mimetype}. Allowed types: images, documents, audio, video, CSV`));
        }
    }
});

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    } else {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
};

const requireAdmin = (req, res, next) => {
    console.log('🔐 Admin middleware check:', {
        hasSession: !!req.session,
        hasUser: !!(req.session && req.session.user),
        userRole: req.session && req.session.user ? req.session.user.role : 'none',
        sessionId: req.sessionID
    });
    
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        console.log('✅ Admin access granted for user:', req.session.user.username);
        return next();
    } else {
        console.log('❌ Admin access denied - insufficient privileges');
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
};

// Authentication routes
app.get('/api/auth/registration-status', (req, res) => {
    try {
        const isEnabled = authService.isRegistrationEnabled();
        const disabledTitle = authService.getSystemSetting('registration_disabled_title') || 'Registration Temporarily Disabled';
        const disabledMessage = authService.getSystemSetting('registration_disabled_message') || 'User registration is currently disabled. Please contact administrator.';
        
        res.json({
            success: true,
            registrationEnabled: isEnabled,
            disabledTitle: disabledTitle,
            disabledMessage: disabledMessage
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password, fullName, phone } = req.body;
        
        const user = await authService.register({
            username,
            email, 
            password,
            fullName,
            phone
        });
        
        req.session.user = user;
        
        res.json({
            success: true,
            message: 'Registration successful',
            user: user
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const user = await authService.login(username, password);
        
        req.session.user = user;
        
        res.json({
            success: true,
            message: 'Login successful',
            user: user
        });
    } catch (error) {
        res.status(401).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: 'Could not logout'
            });
        }
        res.json({
            success: true,
            message: 'Logout successful'
        });
    });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const user = await authService.getUserById(req.session.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        res.json({
            success: true,
            user: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// User profile and password management routes
app.put('/api/user/profile', requireAuth, async (req, res) => {
    try {
        const { fullName, company, phone } = req.body;
        const userId = req.session.user.id;
        
        console.log(`📝 Updating profile for user ${userId}:`, { fullName, company, phone });
        
        // Try database first, fall back to local users
        if (database.isAvailable) {
            try {
                await database.query(
                    'UPDATE users SET full_name = ?, updated_at = NOW() WHERE id = ?',
                    [fullName, userId]
                );
                console.log('✅ Database profile update successful');
            } catch (dbError) {
                console.log('⚠️  Database update failed, using local auth:', dbError.message);
                await authService.updateUserProfile(userId, { fullName, company, phone });
            }
        } else {
            await authService.updateUserProfile(userId, { fullName, company, phone });
        }
        
        // Update session user data
        req.session.user.fullName = fullName;
        req.session.user.full_name = fullName;
        
        res.json({
            success: true,
            message: 'Profile updated successfully'
        });
    } catch (error) {
        console.error('❌ Error updating profile:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/user/change-password', requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.session.user.id;
        const username = req.session.user.username;
        
        console.log(`🔑 Password change request for user ${userId} (${username})`);
        
        // Validation
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'Current password and new password are required'
            });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 6 characters long'
            });
        }
        
        if (currentPassword === newPassword) {
            return res.status(400).json({
                success: false,
                error: 'New password must be different from current password'
            });
        }
        
        // Verify current password
        try {
            await authService.login(username, currentPassword);
            console.log('✅ Current password verified');
        } catch (loginError) {
            console.log('❌ Current password verification failed');
            return res.status(400).json({
                success: false,
                error: 'Current password is incorrect'
            });
        }
        
        // Update password
        try {
            await authService.changePassword(userId, currentPassword, newPassword);
            console.log('✅ Password changed successfully');
            
            res.json({
                success: true,
                message: 'Password changed successfully'
            });
        } catch (changeError) {
            console.error('❌ Error changing password:', changeError);
            res.status(500).json({
                success: false,
                error: 'Failed to change password'
            });
        }
        
    } catch (error) {
        console.error('❌ Error in password change:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// User statistics endpoint
app.get('/api/user/statistics', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        console.log(`📊 Getting statistics for user ${userId}`);
        
        // Get device statistics
        const deviceStats = deviceManager.getDeviceStats(userId);
        
        // Get campaign statistics
        const userCampaigns = campaignManager.getUserCampaigns(userId);
        const campaignStats = {
            total: userCampaigns.length,
            active: userCampaigns.filter(c => c.status === 'active').length,
            completed: userCampaigns.filter(c => c.status === 'completed').length,
            stopped: userCampaigns.filter(c => c.status === 'stopped').length
        };
        
        // Calculate message statistics
        let totalMessages = 0;
        let successfulMessages = 0;
        let failedMessages = 0;
        
        userCampaigns.forEach(campaign => {
            if (campaign.progress) {
                totalMessages += campaign.progress.sent || 0;
                successfulMessages += campaign.progress.sent || 0;
                failedMessages += campaign.progress.failed || 0;
            }
        });
        
        // Calculate success rate
        const successRate = totalMessages > 0 ? Math.round((successfulMessages / totalMessages) * 100) : 0;
        
        const statistics = {
            devices: {
                total: deviceStats.total,
                ready: deviceStats.ready,
                connecting: deviceStats.connecting || 0,
                disconnected: deviceStats.disconnected || 0
            },
            campaigns: {
                total: campaignStats.total,
                active: campaignStats.active,
                completed: campaignStats.completed,
                stopped: campaignStats.stopped
            },
            messages: {
                total: totalMessages,
                successful: successfulMessages,
                failed: failedMessages,
                successRate: successRate
            }
        };
        
        console.log('✅ User statistics calculated:', statistics);
        
        res.json({
            success: true,
            statistics: statistics
        });
    } catch (error) {
        console.error('❌ Error getting user statistics:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Admin routes
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        let users = [];
        
        // Try database first, fall back to local users
        if (database.isAvailable) {
            try {
                users = await database.query(`
                    SELECT id, username, email, full_name, phone, role, is_active, 
                           created_at, updated_at, last_login
                    FROM users 
                    ORDER BY created_at DESC
                `);
            } catch (dbError) {
                console.log('Database query failed, falling back to local users:', dbError.message);
                // Fall through to local users
            }
        }
        
        // If database failed or not available, use local authentication
        if (users.length === 0) {
            // Get users from local authentication service
            const localUsers = await authService.getAllUsers();
            users = localUsers;
        }
        
        res.json({
            success: true,
            users: users
        });
    } catch (error) {
        console.error('Error in /api/admin/users:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.put('/api/admin/users/:id/status', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;
        
        // Try database first, fall back to local users
        if (database.isAvailable) {
            try {
                await database.query(
                    'UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ?',
                    [isActive, id]
                );
            } catch (dbError) {
                console.log('Database update failed, using local auth:', dbError.message);
                await authService.updateUserStatus(id, isActive);
            }
        } else {
            await authService.updateUserStatus(id, isActive);
        }
        
        res.json({
            success: true,
            message: `User ${isActive ? 'activated' : 'deactivated'} successfully`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.put('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        
        if (!['admin', 'user'].includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid role'
            });
        }
        
        // Try database first, fall back to local users
        if (database.isAvailable) {
            try {
                await database.query(
                    'UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?',
                    [role, id]
                );
            } catch (dbError) {
                console.log('Database update failed, using local auth:', dbError.message);
                await authService.updateUserRole(id, role);
            }
        } else {
            await authService.updateUserRole(id, role);
        }
        
        res.json({
            success: true,
            message: 'User role updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if trying to delete self
        if (parseInt(id) === req.session.user.id) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete your own account'
            });
        }
        
        // Try database first, fall back to local users
        if (database.isAvailable) {
            try {
                await database.query('DELETE FROM users WHERE id = ?', [id]);
            } catch (dbError) {
                console.log('Database delete failed, using local auth:', dbError.message);
                await authService.deleteUser(id);
            }
        } else {
            await authService.deleteUser(id);
        }
        
        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Admin system settings routes
app.get('/api/admin/settings', requireAdmin, (req, res) => {
    try {
        const settings = authService.getAllSystemSettings();
        res.json({
            success: true,
            settings: settings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
    try {
        const { settings } = req.body;
        
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Invalid settings data'
            });
        }
        
        // Update each setting
        for (const [key, value] of Object.entries(settings)) {
            authService.updateSystemSetting(key, value);
        }
        
        res.json({
            success: true,
            message: 'Settings updated successfully',
            settings: authService.getAllSystemSettings()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update user expiry
app.put('/api/admin/users/:id/expiry', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { expiryDate } = req.body;
        
        if (!expiryDate) {
            return res.status(400).json({
                success: false,
                error: 'Expiry date is required'
            });
        }
        
        await authService.updateUserExpiry(id, new Date(expiryDate));
        
        res.json({
            success: true,
            message: 'User expiry updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Create new user (admin only)
app.post('/api/admin/users/create', requireAdmin, async (req, res) => {
    try {
        const { username, email, password, fullName, phone, role, expiryDays } = req.body;
        
        // Validate input
        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username, email, and password are required'
            });
        }
        
        if (!['admin', 'user'].includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid role'
            });
        }
        
        // Temporarily enable registration for admin user creation
        const originalRegistrationSetting = authService.getSystemSetting('registration_enabled');
        authService.updateSystemSetting('registration_enabled', true);
        
        try {
            // Create user data
            const userData = {
                username,
                email,
                password,
                fullName,
                phone
            };
            
            // Create user through auth service
            const newUser = await authService.register(userData);
            
            // Update role if needed
            if (role === 'admin') {
                await authService.updateUserRole(newUser.id, 'admin');
            }
            
            // Set expiry if specified
            if (expiryDays && parseInt(expiryDays) > 0) {
                const expiryDate = new Date();
                expiryDate.setDate(expiryDate.getDate() + parseInt(expiryDays));
                await authService.updateUserExpiry(newUser.id, expiryDate);
            }
            
            res.json({
                success: true,
                message: 'User created successfully',
                user: newUser
            });
        } finally {
            // Restore original registration setting
            authService.updateSystemSetting('registration_enabled', originalRegistrationSetting);
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Change admin password
app.put('/api/admin/change-password', requireAdmin, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'Current password and new password are required'
            });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 6 characters long'
            });
        }
        
        // Change password through auth service
        const result = await authService.changePassword(
            req.session.user.id,
            currentPassword,
            newPassword
        );
        
        res.json({
            success: true,
            message: result.message
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Export users (admin only)
app.get('/api/admin/users/export', requireAdmin, async (req, res) => {
    try {
        console.log('🔄 Starting user export...');
        let users = [];
        
        // Try database first, fall back to local users
        if (database.isAvailable) {
            try {
                console.log('🔄 Trying database export...');
                users = await database.query(`
                    SELECT id, username, email, full_name, phone, role, is_active, 
                           created_at, updated_at, last_login, expiry_date
                    FROM users 
                    ORDER BY created_at DESC
                `);
                console.log(`✅ Database export successful: ${users.length} users`);
            } catch (dbError) {
                console.log('⚠️  Database query failed, falling back to local users:', dbError.message);
                // Fall through to local users
            }
        }
        
        // If database failed or not available, use local authentication
        if (users.length === 0) {
            console.log('🔄 Using local authentication for export...');
            const localUsers = await authService.getAllUsers();
            console.log(`✅ Local users retrieved: ${localUsers.length} users`);
            users = localUsers.map(user => ({
                id: user.id,
                username: user.username,
                email: user.email,
                full_name: user.full_name,
                phone: user.phone,
                role: user.role,
                is_active: user.is_active,
                created_at: user.created_at,
                updated_at: user.updated_at,
                last_login: user.last_login,
                expiry_date: user.expiry_date
            }));
        }
        
        // Remove sensitive data for export
        const exportUsers = users.map(user => ({
            username: user.username,
            email: user.email,
            full_name: user.full_name,
            phone: user.phone,
            role: user.role,
            is_active: user.is_active,
            created_at: user.created_at,
            expiry_date: user.expiry_date,
            exported_at: new Date().toISOString(),
            system_version: 'whatsapp-sender-v6'
        }));
        
        console.log(`✅ Export successful: ${exportUsers.length} users prepared for download`);
        
        res.json({
            success: true,
            users: exportUsers,
            count: exportUsers.length,
            exported_at: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error exporting users:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Restore users (admin only)
app.post('/api/admin/users/restore', requireAdmin, async (req, res) => {
    try {
        const { users } = req.body;
        
        if (!users || !Array.isArray(users)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid users data. Expected an array of users.'
            });
        }
        
        let imported = 0;
        let skipped = 0;
        const errors = [];
        
        // Temporarily enable registration for restore process
        const originalRegistrationSetting = authService.getSystemSetting('registration_enabled');
        authService.updateSystemSetting('registration_enabled', true);
        
        try {
            for (const userData of users) {
                try {
                    // Validate required fields
                    if (!userData.username || !userData.email) {
                        errors.push(`Skipping user: Missing username or email`);
                        skipped++;
                        continue;
                    }
                    
                    // Check if user already exists
                    const existingUsers = await authService.getAllUsers();
                    const userExists = existingUsers.some(u => 
                        u.username === userData.username || u.email === userData.email
                    );
                    
                    if (userExists) {
                        console.log(`User ${userData.username} already exists, skipping`);
                        skipped++;
                        continue;
                    }
                    
                    // Generate a default password for restored users
                    const defaultPassword = 'restored123';
                    
                    // Create user with restored data
                    const newUser = await authService.register({
                        username: userData.username,
                        email: userData.email,
                        password: defaultPassword,
                        fullName: userData.full_name || userData.username,
                        phone: userData.phone || null
                    });
                    
                    // Update role if specified
                    if (userData.role && ['admin', 'user'].includes(userData.role)) {
                        await authService.updateUserRole(newUser.id, userData.role);
                    }
                    
                    // Update active status if specified
                    if (typeof userData.is_active === 'boolean') {
                        await authService.updateUserStatus(newUser.id, userData.is_active);
                    }
                    
                    // Update expiry date if specified
                    if (userData.expiry_date) {
                        await authService.updateUserExpiry(newUser.id, new Date(userData.expiry_date));
                    }
                    
                    imported++;
                    console.log(`✅ User ${userData.username} restored successfully`);
                    
                } catch (userError) {
                    console.error(`Error restoring user ${userData.username}:`, userError.message);
                    errors.push(`Error restoring ${userData.username}: ${userError.message}`);
                    skipped++;
                }
            }
        } finally {
            // Restore original registration setting
            authService.updateSystemSetting('registration_enabled', originalRegistrationSetting);
        }
        
        res.json({
            success: true,
            message: `Users restore completed. Imported: ${imported}, Skipped: ${skipped}`,
            imported: imported,
            skipped: skipped,
            errors: errors.length > 0 ? errors : undefined,
            default_password: 'restored123',
            note: 'Restored users have default password "restored123". Please change passwords after login.'
        });
        
    } catch (error) {
        console.error('Error restoring users:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get footer settings (public endpoint)
app.get('/api/footer-settings', (req, res) => {
    try {
        const footerSettings = {
            companyName: authService.getSystemSetting('footer_company_name') || 'WhatsApp Sender Pro',
            description: authService.getSystemSetting('footer_description') || 'Professional WhatsApp messaging platform',
            copyright: authService.getSystemSetting('footer_copyright') || '© 2024 WhatsApp Sender Pro. All rights reserved.',
            supportPhone: authService.getSystemSetting('footer_support_phone') || '+1 (269) 883-2370',
            whatsappLink: authService.getSystemSetting('footer_whatsapp_link') || 'https://wa.me/12698832370'
        };
        
        res.json({
            success: true,
            footer: footerSettings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// WhatsApp API functionality removed
// whatsappAPI.setupRoutes(app);

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API Documentation route - REMOVED (API functionality disabled)

// API endpoint for sending messages
app.post('/send-message', requireAuth, upload.single('attachment'), async (req, res) => {
    try {
        const { sessionId, deviceId, phoneNumber, message } = req.body;
        const attachment = req.file;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: phoneNumber, message'
            });
        }

        let result;
        
        // Try to use DeviceManager first, fall back to SessionManager for backward compatibility
        if (deviceId) {
            const device = deviceManager.getDevice(deviceId);
            if (!device || !device.isReady) {
                return res.status(400).json({
                    success: false,
                    error: 'Device not ready. Please connect your WhatsApp device first.'
                });
            }

            try {
                result = await deviceManager.sendMessage(deviceId, phoneNumber, message, attachment);
                
                // Store single message in history using CampaignManager
                campaignManager.storeMessage({
                    id: uuidv4(),
                    userId: device.userId,
                    campaignId: null, // Single message has no campaign
                    campaignName: null,
                    recipient: {
                        phoneNumber: phoneNumber,
                        name: req.body.recipientName || phoneNumber,
                        city: req.body.recipientCity || '',
                        order: req.body.recipientOrder || ''
                    },
                    content: message,
                    deviceId: deviceId,
                    deviceName: device.name,
                    status: 'sent',
                    timestamp: new Date(),
                    responseTime: null
                });
                
                // Emit success event to the user
                io.to(device.userId).emit('message-sent', {
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: new Date().toISOString(),
                    deviceId: deviceId
                });
            } catch (messageError) {
                // Store failed message in history
                campaignManager.storeMessage({
                    id: uuidv4(),
                    userId: device.userId,
                    campaignId: null,
                    campaignName: null,
                    recipient: {
                        phoneNumber: phoneNumber,
                        name: req.body.recipientName || phoneNumber,
                        city: req.body.recipientCity || '',
                        order: req.body.recipientOrder || ''
                    },
                    content: message,
                    deviceId: deviceId,
                    deviceName: device.name,
                    status: 'failed',
                    timestamp: new Date(),
                    responseTime: null,
                    error: messageError.message
                });
                
                // Re-throw the error to be handled by the outer catch block
                throw messageError;
            }
        } else if (sessionId) {
            // Backward compatibility with old session-based approach
            const session = sessionManager.getSession(sessionId);
            if (!session || !session.client || !session.isReady) {
                return res.status(400).json({
                    success: false,
                    error: 'WhatsApp session not ready. Please scan QR code first.'
                });
            }

            // Format phone number
            const formattedNumber = phoneNumber.replace(/\D/g, '');
            const chatId = formattedNumber.includes('@') ? formattedNumber : `${formattedNumber}@c.us`;

            // Send message
            if (attachment) {
                const media = require('whatsapp-web.js').MessageMedia.fromFilePath(attachment.path);
                result = await session.client.sendMessage(chatId, media, { caption: message });
            } else {
                result = await session.client.sendMessage(chatId, message);
            }

            // Emit success event to the session
            io.to(sessionId).emit('message-sent', {
                success: true,
                messageId: result.id._serialized,
                timestamp: new Date().toISOString()
            });
        } else {
            return res.status(400).json({
                success: false,
                error: 'Either deviceId or sessionId is required'
            });
        }

        // Clean up uploaded file after sending
        if (attachment) {
            setTimeout(() => {
                fs.unlink(attachment.path, (err) => {
                    if (err) console.error('Error deleting uploaded file:', err);
                });
            }, 5000);
        }

        res.json({
            success: true,
            messageId: result.id._serialized,
            message: 'Message sent successfully'
        });

    } catch (error) {
        console.error('Error sending message:', error);
        
        // Emit error event
        if (req.body.deviceId) {
            const device = deviceManager.getDevice(req.body.deviceId);
            if (device) {
                io.to(device.userId).emit('message-error', {
                    success: false,
                    error: error.message,
                    deviceId: req.body.deviceId
                });
            }
        } else if (req.body.sessionId) {
            io.to(req.body.sessionId).emit('message-error', {
                success: false,
                error: error.message
            });
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint for bulk messaging
app.post('/send-bulk-messages', requireAuth, upload.fields([
    { name: 'csvFile', maxCount: 1 },
    { name: 'attachment', maxCount: 1 }
]), async (req, res) => {
    try {
        const { userId, message, delay, rotationStrategy, selectedDevices } = req.body;
        const csvFile = req.files['csvFile'] ? req.files['csvFile'][0] : null;
        const attachment = req.files['attachment'] ? req.files['attachment'][0] : null;

        console.log('Bulk messaging request:', { userId, message: message ? 'present' : 'missing', csvFile: csvFile ? 'present' : 'missing' });

        if (!userId || !message) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userId and message are required'
            });
        }
        
        if (!csvFile) {
            return res.status(400).json({
                success: false,
                error: 'CSV file is required for bulk messaging'
            });
        }

        // Check if user has ready devices
        const readyDevices = deviceManager.getReadyDevices(userId);
        if (readyDevices.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No ready WhatsApp devices available. Please connect at least one device.'
            });
        }

        // Parse CSV file
        const recipients = [];
        const csvPath = csvFile.path;
        
        await new Promise((resolve, reject) => {
            fs.createReadStream(csvPath)
                .pipe(csv())
                .on('data', (row) => {
                    // Support multiple CSV formats
                    const phoneNumber = row.phone || row.phoneNumber || row.number || row.Phone || row.PhoneNumber;
                    const name = row.name || row.Name || phoneNumber;
                    const city = row.city || row.City || '';
                    const order = row.order || row.Order || row.id || row.ID || '';
                    
                    if (phoneNumber) {
                        recipients.push({
                            phoneNumber: phoneNumber.toString().replace(/\D/g, ''),
                            name: name.toString(),
                            city: city.toString(),
                            order: order.toString()
                        });
                    }
                })
                .on('end', () => {
                    resolve();
                })
                .on('error', (error) => {
                    reject(error);
                });
        });

        if (recipients.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid recipients found in CSV file. Make sure it has a "phone" or "phoneNumber" column.'
            });
        }

        // Parse selected devices if provided
        let parsedSelectedDevices = null;
        if (selectedDevices) {
            try {
                parsedSelectedDevices = JSON.parse(selectedDevices);
            } catch (e) {
                console.warn('Failed to parse selectedDevices:', e);
            }
        }

        // Create persistent campaign instead of immediate bulk sending
        const campaignData = {
            name: req.body.campaignName || `Campaign ${Date.now()}`,
            message: message,
            recipients: recipients,
            attachment: attachment,
            delay: req.body.delayOption || delay,
            rotationStrategy: rotationStrategy,
            selectedDevices: parsedSelectedDevices,
            messagesPerDevice: parseInt(req.body.messagesPerDevice) || 10,
            customMinDelay: parseInt(req.body.customMinDelay) || 5,
            customMaxDelay: parseInt(req.body.customMaxDelay) || 20,
            enableTypingSimulation: req.body.enableTypingSimulation !== 'false'
        };

        console.log('Creating persistent campaign with data:', campaignData);

        // Create and start campaign
        const campaign = await campaignManager.createCampaign(userId, campaignData);

        // Clean up CSV file
        setTimeout(() => {
            fs.unlink(csvPath, (err) => {
                if (err) console.error('Error deleting CSV file:', err);
            });
        }, 5000);

        res.json({
            success: true,
            message: 'Persistent campaign started',
            campaignId: campaign.id,
            campaignName: campaign.name,
            recipients: recipients.length,
            devices: readyDevices.length
        });

    } catch (error) {
        console.error('Error starting bulk messaging:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    let userId = null;

    // Handle user identification (supports both Firebase and legacy users)
    socket.on('identify-user', (data) => {
        userId = data.userId;
        socket.join(userId);
        socket.userId = userId;
        
        // Check if this is a Firebase user
        const isFirebaseUser = userId && userId.startsWith('firebase_');
        
        console.log(`User ${socket.id} identified as ${userId} (Firebase: ${isFirebaseUser})`);
        
        // Send current devices for this user
        const userDevices = deviceManager.getUserDevices(userId);
        socket.emit('user-devices', {
            devices: userDevices.map(device => ({
                id: device.id,
                name: device.name,
                status: device.status,
                isReady: device.isReady,
                phoneNumber: device.phoneNumber,
                createdAt: device.createdAt,
                lastActivity: device.lastActivity
            }))
        });
        
        // Send active campaigns for this user
        const userCampaigns = campaignManager.getUserCampaigns(userId);
        const activeCampaigns = userCampaigns.filter(c => c.status === 'active');
        if (activeCampaigns.length > 0) {
            socket.emit('active-campaigns-recovered', {
                campaigns: activeCampaigns.map(campaign => ({
                    id: campaign.id,
                    name: campaign.name,
                    progress: campaign.progress
                }))
            });
        }
    });

    // Handle creating new device
    socket.on('create-device', async (data) => {
        try {
            if (!userId) {
                socket.emit('error', { message: 'User not identified' });
                return;
            }

            const deviceName = data.deviceName || 'WhatsApp Device';
            console.log(`Creating device "${deviceName}" for user: ${userId}`);
            
            const device = await deviceManager.createDevice(userId, deviceName);
            
            console.log(`Device "${deviceName}" created successfully with ID: ${device.id}`);
            
            socket.emit('device-created', {
                deviceId: device.id,
                message: `Device "${deviceName}" created successfully`,
                device: {
                    id: device.id,
                    name: device.name,
                    status: device.status,
                    isReady: device.isReady,
                    createdAt: device.createdAt
                }
            });

        } catch (error) {
            console.error(`Error creating device "${data.deviceName || 'Unknown'}":`, error);
            socket.emit('error', {
                message: `Failed to create device "${data.deviceName || 'Unknown'}": ${error.message}`,
                deviceName: data.deviceName,
                error: error.message
            });
        }
    });

    // Handle device deletion
    socket.on('delete-device', async (data) => {
        try {
            const { deviceId } = data;
            const device = deviceManager.getDevice(deviceId);
            
            if (!device || device.userId !== userId) {
                socket.emit('error', { message: 'Device not found or access denied' });
                return;
            }

            await deviceManager.deleteDevice(deviceId);
            
            io.to(userId).emit('device-deleted', {
                deviceId: deviceId,
                message: 'Device deleted successfully'
            });

        } catch (error) {
            console.error('Error deleting device:', error);
            socket.emit('error', {
                message: 'Failed to delete device',
                error: error.message
            });
        }
    });

    // Handle get device status
    socket.on('get-device-status', (data) => {
        const { deviceId } = data;
        const device = deviceManager.getDevice(deviceId);
        
        if (!device || device.userId !== userId) {
            socket.emit('error', { message: 'Device not found or access denied' });
            return;
        }

        socket.emit('device-status', {
            deviceId: deviceId,
            status: device.status,
            isReady: device.isReady,
            phoneNumber: device.phoneNumber
        });
    });
    
    // Handle get device QR code
    socket.on('get-device-qr', async (data) => {
        const { deviceId } = data;
        const device = deviceManager.getDevice(deviceId);
        
        if (!device || device.userId !== userId) {
            socket.emit('error', { message: 'Device not found or access denied' });
            return;
        }
        
        try {
            // If device already has QR code, send it
            if (device.qrCode) {
                socket.emit('device-qr-code', {
                    deviceId: deviceId,
                    qrCode: device.qrCode,
                    message: 'QR code retrieved from cache',
                    timestamp: device.qrGeneratedAt || new Date()
                });
            } else {
                // Try to force QR generation
                console.log(`Forcing QR generation for device ${deviceId}`);
                await deviceManager.forceQRGeneration(deviceId);
                
                // Send status update
                socket.emit('device-status', {
                    deviceId: deviceId,
                    status: device.status,
                    isReady: device.isReady,
                    message: 'Generating QR code...'
                });
            }
        } catch (error) {
            console.error(`Error getting QR for device ${deviceId}:`, error);
            socket.emit('error', { 
                message: 'Failed to get QR code: ' + error.message,
                deviceId: deviceId
            });
        }
    });

    // Handle get user statistics
    socket.on('get-user-stats', () => {
        if (!userId) {
            socket.emit('error', { message: 'User not identified' });
            return;
        }

        const stats = deviceManager.getDeviceStats(userId);
        socket.emit('user-stats', stats);
    });

    // Campaign management socket events
    socket.on('stop-campaign', (data) => {
        try {
            const { campaignId } = data;
            const success = campaignManager.stopCampaign(campaignId, userId);
            
            if (success) {
                socket.emit('campaign-stopped', {
                    campaignId: campaignId,
                    message: 'Campaign stopped successfully'
                });
            } else {
                socket.emit('error', {
                    message: 'Campaign not found or access denied'
                });
            }
        } catch (error) {
            console.error('Error stopping campaign:', error);
            socket.emit('error', {
                message: 'Failed to stop campaign',
                error: error.message
            });
        }
    });

    // Restart campaign socket event
    socket.on('restart-campaign', (data) => {
        try {
            const { campaignId } = data;
            const success = campaignManager.restartCampaign(campaignId, userId);
            
            if (success) {
                socket.emit('campaign-restarted', {
                    campaignId: campaignId,
                    message: 'Campaign restarted successfully'
                });
            } else {
                socket.emit('error', {
                    message: 'Campaign not found or access denied'
                });
            }
        } catch (error) {
            console.error('Error restarting campaign:', error);
            socket.emit('error', {
                message: 'Failed to restart campaign',
                error: error.message
            });
        }
    });

    socket.on('get-user-campaigns', () => {
        try {
            if (!userId) {
                socket.emit('error', { message: 'User not identified' });
                return;
            }

            const campaigns = campaignManager.getUserCampaigns(userId);
            socket.emit('user-campaigns', {
                campaigns: campaigns.map(campaign => ({
                    id: campaign.id,
                    name: campaign.name,
                    status: campaign.status,
                    progress: campaign.progress,
                    createdAt: campaign.createdAt,
                    updatedAt: campaign.updatedAt
                }))
            });
        } catch (error) {
            console.error('Error getting user campaigns:', error);
            socket.emit('error', {
                message: 'Failed to get campaigns',
                error: error.message
            });
        }
    });

    socket.on('get-campaign-status', (data) => {
        try {
            const { campaignId } = data;
            const campaigns = campaignManager.getUserCampaigns(userId);
            const campaign = campaigns.find(c => c.id === campaignId);
            
            if (campaign) {
                socket.emit('campaign-status', {
                    campaignId: campaignId,
                    status: campaign.status,
                    progress: campaign.progress,
                    rotationState: {
                        strategy: campaign.rotationState.strategy,
                        deviceUsage: Object.fromEntries(campaign.rotationState.deviceUsage || new Map())
                    }
                });
            } else {
                socket.emit('error', {
                    message: 'Campaign not found or access denied'
                });
            }
        } catch (error) {
            console.error('Error getting campaign status:', error);
            socket.emit('error', {
                message: 'Failed to get campaign status',
                error: error.message
            });
        }
    });

    // Handle get history data
    socket.on('get-history-data', (data) => {
        console.log('=== History Data Request ===');
        console.log('Request from user:', data?.userId);
        console.log('Current userId:', userId);
        
        try {
            if (!userId) {
                console.log('User not identified, sending error');
                socket.emit('error', { message: 'User not identified' });
                return;
            }

            console.log('Getting campaigns for user:', userId);
            const campaigns = campaignManager.getUserCampaigns(userId);
            console.log('Found campaigns:', campaigns.length);
            
            // Get user messages from campaign manager
            const messages = campaignManager.getUserMessages(userId);
            console.log('Found messages:', messages.length);

            // Sort campaigns by creation date (newest first)
            campaigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            
            // Sort messages by timestamp (newest first)
            messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            console.log('Total real campaigns:', campaigns.length);
            console.log('Total real messages:', messages.length);

            const responseData = {
                campaigns: campaigns.map(campaign => ({
                    id: campaign.id,
                    name: campaign.name,
                    status: campaign.status,
                    createdAt: campaign.createdAt,
                    updatedAt: campaign.updatedAt,
                    progress: campaign.progress,
                    message: campaign.message
                })),
                messages: messages // Real messages from campaigns
            };
            
            console.log('Sending history data response:', {
                campaignCount: responseData.campaigns.length,
                messageCount: responseData.messages.length,
                realCampaigns: true,
                realMessages: true
            });
            
            socket.emit('history-data', responseData);
            console.log('=== History Data Response Sent ===');
        } catch (error) {
            console.error('Error getting history data:', error);
            socket.emit('error', {
                message: 'Failed to get history data',
                error: error.message
            });
        }
    });

    // Handle clear history data
    socket.on('clear-history-data', (data) => {
        try {
            if (!userId) {
                socket.emit('error', { message: 'User not identified' });
                return;
            }

            console.log('Clearing history for user:', userId);
            
            // Clear user campaigns
            campaignManager.clearUserCampaigns(userId);
            
            socket.emit('history-cleared', {
                success: true,
                message: 'History cleared successfully'
            });
            
            console.log('History cleared for user:', userId);
        } catch (error) {
            console.error('Error clearing history:', error);
            socket.emit('error', {
                message: 'Failed to clear history',
                error: error.message
            });
        }
    });

    // Legacy session management (backward compatibility)
    // Handle session joining
    socket.on('join-session', async (sessionId) => {
        try {
            console.log(`User ${socket.id} joining session: ${sessionId}`);
            
            // Join the session room
            socket.join(sessionId);
            socket.sessionId = sessionId;

            // Create or get existing session
            const session = await sessionManager.createSession(sessionId);
            
            // Emit current session status
            socket.emit('session-status', {
                sessionId: sessionId,
                status: session.status,
                isReady: session.isReady
            });

            // If session is already ready, emit ready status
            if (session.isReady) {
                socket.emit('session-ready', {
                    sessionId: sessionId,
                    message: 'WhatsApp session is ready!'
                });
            }

        } catch (error) {
            console.error('Error joining session:', error);
            socket.emit('error', {
                message: 'Failed to join session',
                error: error.message
            });
        }
    });

    // Handle session deletion
    socket.on('delete-session', async (sessionId) => {
        try {
            console.log(`Deleting session: ${sessionId}`);
            
            await sessionManager.deleteSession(sessionId);
            
            // Notify all clients in the session room
            io.to(sessionId).emit('session-deleted', {
                sessionId: sessionId,
                message: 'Session deleted successfully'
            });

            // Remove all sockets from the session room
            const room = io.sockets.adapter.rooms.get(sessionId);
            if (room) {
                room.forEach(socketId => {
                    const socket = io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.leave(sessionId);
                    }
                });
            }

        } catch (error) {
            console.error('Error deleting session:', error);
            socket.emit('error', {
                message: 'Failed to delete session',
                error: error.message
            });
        }
    });

    // Handle get session status
    socket.on('get-session-status', (sessionId) => {
        const session = sessionManager.getSession(sessionId);
        socket.emit('session-status', {
            sessionId: sessionId,
            status: session ? session.status : 'not-found',
            isReady: session ? session.isReady : false
        });
    });

    // Handle session joining
    socket.on('join-session', async (sessionId) => {
        try {
            console.log(`User ${socket.id} joining session: ${sessionId}`);
            
            // Join the session room
            socket.join(sessionId);
            socket.sessionId = sessionId;

            // Create or get existing session
            const session = await sessionManager.createSession(sessionId);
            
            // Emit current session status
            socket.emit('session-status', {
                sessionId: sessionId,
                status: session.status,
                isReady: session.isReady
            });

            // If session is already ready, emit ready status
            if (session.isReady) {
                socket.emit('session-ready', {
                    sessionId: sessionId,
                    message: 'WhatsApp session is ready!'
                });
            }

        } catch (error) {
            console.error('Error joining session:', error);
            socket.emit('error', {
                message: 'Failed to join session',
                error: error.message
            });
        }
    });

    // Handle session deletion
    socket.on('delete-session', async (sessionId) => {
        try {
            console.log(`Deleting session: ${sessionId}`);
            
            await sessionManager.deleteSession(sessionId);
            
            // Notify all clients in the session room
            io.to(sessionId).emit('session-deleted', {
                sessionId: sessionId,
                message: 'Session deleted successfully'
            });

            // Remove all sockets from the session room
            const room = io.sockets.adapter.rooms.get(sessionId);
            if (room) {
                room.forEach(socketId => {
                    const socket = io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.leave(sessionId);
                    }
                });
            }

        } catch (error) {
            console.error('Error deleting session:', error);
            socket.emit('error', {
                message: 'Failed to delete session',
                error: error.message
            });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        // Leave user room if identified
        if (userId) {
            socket.leave(userId);
        }
        
        // Leave session room if using legacy approach
        if (socket.sessionId) {
            socket.leave(socket.sessionId);
        }
    });

    // Handle get session status
    socket.on('get-session-status', (sessionId) => {
        const session = sessionManager.getSession(sessionId);
        socket.emit('session-status', {
            sessionId: sessionId,
            status: session ? session.status : 'not-found',
            isReady: session ? session.isReady : false
        });
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nGraceful shutdown initiated...');
    
    try {
        await Promise.all([
            deviceManager.cleanup(),
            sessionManager.cleanup()
        ]);
        console.log('All managers cleaned up successfully');
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
    
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    
    try {
        await Promise.all([
            deviceManager.cleanup(),
            sessionManager.cleanup()
        ]);
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
    
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Start server
const PORT = process.env.PORT || 3001; // Use port 3001 for local development
server.listen(PORT, () => {
    console.log(`WhatsApp Sender Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to access the application`);
});

module.exports = { app, server, io, deviceManager, sessionManager };