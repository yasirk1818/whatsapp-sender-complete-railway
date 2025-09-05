// Firebase system completely removed - using local authentication only

// Fallback local users for when Firebase is not available
const localUsers = new Map();
let userIdCounter = 1;

// System settings
const systemSettings = new Map();
systemSettings.set('registration_enabled', true);
systemSettings.set('default_user_expiry_days', 1);
systemSettings.set('user_expiry_enabled', true);
systemSettings.set('registration_disabled_message', 'User registration is currently disabled. Please contact administrator.');
systemSettings.set('registration_disabled_title', 'Registration Temporarily Disabled');
systemSettings.set('account_expired_message', 'Your account has expired. Please contact administrator to renew access.');
systemSettings.set('account_expired_title', 'Account Expired');
systemSettings.set('footer_company_name', 'WhatsApp Sender Pro');
systemSettings.set('footer_description', 'Professional WhatsApp messaging platform');
systemSettings.set('footer_copyright', '© 2024 WhatsApp Sender Pro. All rights reserved.');
systemSettings.set('footer_support_phone', '+1 (269) 883-2370');
systemSettings.set('footer_whatsapp_link', 'https://wa.me/12698832370');

class AuthService {
    constructor() {
        this.maxLoginAttempts = 5;
        this.lockoutTime = 15 * 60 * 1000; // 15 minutes
        this.loginAttempts = new Map(); // Track login attempts for local auth
        this.initializeDefaultAdmin();
    }

    /**
     * Check if user registration is enabled
     */
    isRegistrationEnabled() {
        return systemSettings.get('registration_enabled') === true;
    }

    /**
     * Get system setting
     */
    getSystemSetting(key) {
        return systemSettings.get(key);
    }

    /**
     * Update system setting
     */
    updateSystemSetting(key, value) {
        systemSettings.set(key, value);
        console.log(`✅ System setting updated: ${key} = ${value}`);
    }

    /**
     * Get all system settings
     */
    getAllSystemSettings() {
        return Object.fromEntries(systemSettings);
    }

    /**
     * Check if user is expired
     */
    isUserExpired(user) {
        if (!systemSettings.get('user_expiry_enabled')) {
            return false;
        }

        if (!user.expiryDate) {
            return false; // No expiry date set
        }

        return new Date() > new Date(user.expiryDate);
    }

    /**
     * Calculate user expiry date
     */
    calculateExpiryDate(daysFromNow = null) {
        const days = daysFromNow || systemSettings.get('default_user_expiry_days') || 30;
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + days);
        return expiryDate;
    }

    /**
     * Update user expiry
     */
    async updateUserExpiry(userId, expiryDate) {
        try {
            // Update local user only
            for (const [key, user] of localUsers) {
                if (user.id === userId || user.id === parseInt(userId)) {
                    user.expiryDate = expiryDate;
                    user.updatedAt = new Date();
                    localUsers.set(key, user);
                    return { success: true };
                }
            }

            throw new Error('User not found');
        } catch (error) {
            console.error('Update user expiry error:', error.message);
            throw error;
        }
    }

    /**
     * Initialize default admin user
     */
    async initializeDefaultAdmin() {
        try {
            // Create local admin user only
            if (!localUsers.has('admin')) {
                const bcrypt = require('bcryptjs');
                const hashedPassword = await bcrypt.hash('admin123', 12);
                
                localUsers.set('admin', {
                    id: userIdCounter++,
                    username: 'admin',
                    email: 'admin@whatsapp-sender.local',
                    password_hash: hashedPassword,
                    fullName: 'System Administrator',
                    role: 'admin',
                    createdAt: new Date(),
                    isActive: true
                });
                
                console.log('✅ Default local admin user created');
                console.log('📝 Default login credentials:');
                console.log('   Username: admin');
                console.log('   Password: admin123');
                console.log('   ⚠️  Please change this password after first login!');
            }
        } catch (error) {
            console.error('❌ Error initializing admin user:', error.message);
        }
    }

    /**
     * Register a new user
     */
    async register(userData) {
        const { username, email, password, fullName, phone } = userData;

        try {
            // Check if registration is enabled
            if (!this.isRegistrationEnabled()) {
                const customMessage = systemSettings.get('registration_disabled_message') || 
                    'User registration is currently disabled. Please contact administrator.';
                throw new Error(customMessage);
            }

            // Validate input
            if (!username || !email || !password) {
                throw new Error('Username, email, and password are required');
            }

            if (password.length < 6) {
                throw new Error('Password must be at least 6 characters long');
            }

            // Calculate expiry date
            const expiryDate = systemSettings.get('user_expiry_enabled') ? 
                this.calculateExpiryDate() : null;

            // Local registration only
            console.log('🔄 Using local authentication for registration');
            
            // Check if user already exists locally
            for (const [key, user] of localUsers) {
                if (user.username === username || user.email === email) {
                    throw new Error('User with this username or email already exists');
                }
            }

            // Hash password
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash(password, 12);

            // Create local user
            const userId = userIdCounter++;
            const now = new Date();
            const newUser = {
                id: userId,
                username,
                email,
                password_hash: hashedPassword,
                fullName: fullName || null,
                phone: phone || null,
                role: 'user',
                createdAt: now,
                updatedAt: now,
                lastLogin: null, // Will be set on first login
                isActive: true,
                expiryDate: expiryDate
            };
            
            localUsers.set(username, newUser);
            console.log('✅ User registered locally:', username);

            // Return user data (without password)
            return {
                id: userId,
                username,
                email,
                fullName,
                phone,
                role: 'user',
                createdAt: newUser.createdAt,
                expiryDate: newUser.expiryDate
            };

        } catch (error) {
            console.error('Registration error:', error.message);
            throw error;
        }
    }

    /**
     * Login user with local credentials only
     */
    async login(usernameOrToken, password = null) {
        try {
            if (!usernameOrToken) {
                throw new Error('Username/email is required');
            }

            // Local authentication only
            if (!password) {
                throw new Error('Password is required for local authentication');
            }

            console.log('🔄 Using local authentication for login');
            
            // Find user locally
            let user = null;
            for (const [key, localUser] of localUsers) {
                if (localUser.username === usernameOrToken || localUser.email === usernameOrToken) {
                    user = localUser;
                    break;
                }
            }

            if (!user) {
                throw new Error('Invalid username or password');
            }

            // Check if account is active
            if (!user.isActive) {
                throw new Error('Account is deactivated. Please contact administrator.');
            }

            // Check if user is expired
            if (this.isUserExpired(user)) {
                const customMessage = systemSettings.get('account_expired_message') || 
                    'Your account has expired. Please contact administrator to renew access.';
                throw new Error(customMessage);
            }

            // Check login attempts
            const attemptKey = user.username;
            const attempts = this.loginAttempts.get(attemptKey) || { count: 0, lockedUntil: null };
            
            if (attempts.lockedUntil && new Date(attempts.lockedUntil) > new Date()) {
                const unlockTime = new Date(attempts.lockedUntil).toLocaleString();
                throw new Error(`Account is locked until ${unlockTime}. Please try again later.`);
            }

            // Verify password
            const bcrypt = require('bcryptjs');
            const isValidPassword = await bcrypt.compare(password, user.password_hash);

            if (!isValidPassword) {
                // Increment login attempts
                attempts.count++;
                if (attempts.count >= this.maxLoginAttempts) {
                    attempts.lockedUntil = new Date(Date.now() + this.lockoutTime);
                }
                this.loginAttempts.set(attemptKey, attempts);
                throw new Error('Invalid username or password');
            }

            // Reset login attempts
            this.loginAttempts.delete(attemptKey);
            
            // Update last login time
            user.lastLogin = new Date();
            user.updatedAt = new Date();
            localUsers.set(user.username, user);
            
            console.log('✅ User logged in locally:', user.username);

            // Return user data (without password)
            return {
                id: user.id,
                username: user.username,
                email: user.email,
                fullName: user.fullName,
                phone: user.phone,
                role: user.role,
                isActive: user.isActive,
                lastLogin: user.lastLogin,
                createdAt: user.createdAt,
                expiryDate: user.expiryDate
            };

        } catch (error) {
            console.error('Login error:', error.message);
            throw error;
        }
    }

    /**
     * Get user by ID (local ID only)
     */
    async getUserById(userId) {
        try {
            // Search local users only
            for (const [key, user] of localUsers) {
                if (user.id === userId || user.id === parseInt(userId)) {
                    return {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        fullName: user.fullName,
                        full_name: user.fullName, // For compatibility
                        phone: user.phone,
                        role: user.role,
                        is_active: user.isActive,
                        isActive: user.isActive, // For compatibility
                        created_at: user.createdAt,
                        createdAt: user.createdAt, // For compatibility
                        updated_at: user.updatedAt || user.createdAt,
                        last_login: user.lastLogin,
                        lastLogin: user.lastLogin, // For compatibility
                        expiry_date: user.expiryDate,
                        expiryDate: user.expiryDate, // For compatibility
                        is_expired: this.isUserExpired(user)
                    };
                }
            }

            return null;
        } catch (error) {
            console.error('Get user error:', error.message);
            throw error;
        }
    }

    /**
     * Update user profile
     */
    async updateProfile(userId, updateData) {
        try {
            const { fullName, phone, email } = updateData;

            // Update local user only
            for (const [key, user] of localUsers) {
                if (user.id === userId || user.id === parseInt(userId)) {
                    if (fullName !== undefined) user.fullName = fullName;
                    if (phone !== undefined) user.phone = phone;
                    if (email !== undefined) {
                        // Check if email is already taken
                        for (const [otherKey, otherUser] of localUsers) {
                            if (otherUser.id !== user.id && otherUser.email === email) {
                                throw new Error('Email is already taken by another user');
                            }
                        }
                        user.email = email;
                    }
                    
                    localUsers.set(key, user);
                    return {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        fullName: user.fullName,
                        phone: user.phone,
                        role: user.role
                    };
                }
            }

            throw new Error('User not found');
        } catch (error) {
            console.error('Update profile error:', error.message);
            throw error;
        }
    }

    /**
     * Get authentication type (always local now)
     */
    getAuthType() {
        return 'local';
    }

    /**
     * Get all users (for admin panel)
     */
    async getAllUsers() {
        try {
            // Use local users only
            console.log('🔄 Using local users for admin panel');
            const users = [];
            for (const [key, user] of localUsers) {
                users.push({
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    full_name: user.fullName,
                    phone: user.phone,
                    role: user.role,
                    is_active: user.isActive,
                    created_at: user.createdAt,
                    updated_at: user.updatedAt || user.createdAt,
                    last_login: user.lastLogin,
                    expiry_date: user.expiryDate,
                    is_expired: this.isUserExpired(user)
                });
            }
            
            // Sort by creation date (newest first)
            users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            
            return users;
        } catch (error) {
            console.error('Get all users error:', error.message);
            throw error;
        }
    }

    /**
     * Update user status (for admin panel)
     */
    async updateUserStatus(userId, isActive) {
        try {
            // Update local user only
            for (const [key, user] of localUsers) {
                if (user.id === userId || user.id === parseInt(userId)) {
                    user.isActive = isActive;
                    user.updatedAt = new Date();
                    localUsers.set(key, user);
                    return { success: true };
                }
            }

            throw new Error('User not found');
        } catch (error) {
            console.error('Update user status error:', error.message);
            throw error;
        }
    }

    /**
     * Update user role (for admin panel)
     */
    async updateUserRole(userId, role) {
        try {
            if (!['admin', 'user'].includes(role)) {
                throw new Error('Invalid role');
            }

            // Update local user only
            for (const [key, user] of localUsers) {
                if (user.id === userId || user.id === parseInt(userId)) {
                    user.role = role;
                    user.updatedAt = new Date();
                    localUsers.set(key, user);
                    return { success: true };
                }
            }

            throw new Error('User not found');
        } catch (error) {
            console.error('Update user role error:', error.message);
            throw error;
        }
    }

    /**
     * Delete user (for admin panel)
     */
    async deleteUser(userId) {
        try {
            // Delete local user only
            for (const [key, user] of localUsers) {
                if (user.id === userId || user.id === parseInt(userId)) {
                    localUsers.delete(key);
                    return { success: true };
                }
            }

            throw new Error('User not found');
        } catch (error) {
            console.error('Delete user error:', error.message);
            throw error;
        }
    }

    // Legacy methods for compatibility (now use local storage)
    async updateUserProfile(userId, profileData) {
        try {
            const { fullName, company, phone } = profileData;
            
            // Find user locally
            let user = null;
            let userKey = null;
            for (const [key, localUser] of localUsers) {
                if (localUser.id === userId || localUser.id === parseInt(userId)) {
                    user = localUser;
                    userKey = key;
                    break;
                }
            }

            if (!user) {
                throw new Error('User not found');
            }

            // Update profile data
            if (fullName !== undefined) user.fullName = fullName;
            if (fullName !== undefined) user.full_name = fullName; // For compatibility
            if (company !== undefined) user.company = company;
            if (phone !== undefined) user.phone = phone;
            user.updatedAt = new Date();
            
            // Update in local storage
            localUsers.set(userKey, user);

            return { success: true, message: 'Profile updated successfully' };

        } catch (error) {
            console.error('Update profile error:', error.message);
            throw error;
        }
    }

    async changePassword(userId, currentPassword, newPassword) {
        try {
            if (!currentPassword || !newPassword) {
                throw new Error('Current password and new password are required');
            }

            if (newPassword.length < 6) {
                throw new Error('New password must be at least 6 characters long');
            }

            // Find user locally
            let user = null;
            for (const [key, localUser] of localUsers) {
                if (localUser.id === userId || localUser.id === parseInt(userId)) {
                    user = localUser;
                    break;
                }
            }

            if (!user) {
                throw new Error('User not found');
            }

            // Verify current password
            const bcrypt = require('bcryptjs');
            const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);

            if (!isValidPassword) {
                throw new Error('Current password is incorrect');
            }

            // Hash new password
            const hashedNewPassword = await bcrypt.hash(newPassword, 12);
            user.password_hash = hashedNewPassword;

            return { success: true, message: 'Password changed successfully' };

        } catch (error) {
            console.error('Change password error:', error.message);
            throw error;
        }
    }

}

module.exports = new AuthService();