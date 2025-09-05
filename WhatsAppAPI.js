const express = require('express');
// const rateLimit = require('express-rate-limit'); // Disabled as API functionality is removed
const { v4: uuidv4 } = require('uuid');

class WhatsAppAPI {
    constructor(io, sessionManager, deviceManager) {
        this.io = io;
        this.sessionManager = sessionManager;
        this.deviceManager = deviceManager;
        this.apiKeys = new Map(); // Store API keys
        this.messageQueue = new Map(); // Store pending messages
        this.deviceUsageStats = new Map(); // Track device usage {deviceId: {lastUsed, messageCount, status}}
        this.initializeDefaultApiKey();
    }

    initializeDefaultApiKey() {
        // API functionality removed
        console.log('ℹ️ API functionality has been disabled');
    }

    // API Key validation middleware - DISABLED
    validateApiKey(req, res, next) {
        return res.status(503).json({
            success: false,
            error: 'API functionality has been disabled'
        });
    }

    // Rate limiting for API endpoints - DISABLED
    createRateLimit(windowMs = 15 * 60 * 1000, max = 100) {
        return (req, res, next) => {
            return res.status(503).json({
                success: false,
                error: 'API functionality has been disabled'
            });
        };
    }

    // Setup API routes - DISABLED
    setupRoutes(app) {
        // All API endpoints disabled
        app.use('/api/v1/*', (req, res) => {
            res.status(503).json({
                success: false,
                error: 'API functionality has been disabled',
                message: 'All API endpoints have been removed from this application'
            });
        });
        
        console.log('ℹ️ All API routes have been disabled');
    }

    // All API functions have been disabled
    async sendMessage(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    trackDeviceUsage(deviceId, userId) { return null; }
    getDeviceUsageStats(userId) { return new Map(); }
    getMostUsedDevice(usageStats) { return null; }

    async sendMessageWithDevice(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    async sendMessageViaGet(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    async sendBulkMessages(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    async getDevices(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    async createDevice(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    async getDevice(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    async deleteDevice(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    async getDeviceQR(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    async getStatus(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    async getHealth(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    async createApiKey(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    async getApiKeys(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    async deleteApiKey(req, res) {
        return res.status(503).json({ success: false, error: 'API functionality has been disabled' });
    }

    formatPhoneNumber(phone) { return null; }
    getDefaultApiKey() { return null; }
}

module.exports = WhatsAppAPI;