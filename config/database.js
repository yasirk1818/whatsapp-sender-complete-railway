// Database configuration - DISABLED (Using local file storage only)
// MariaDB functionality has been completely removed
const fs = require('fs');
const path = require('path');

const dbConfig = {
    // Database disabled - using local file storage
    disabled: true
};

class Database {
    constructor() {
        this.pool = null;
        this.isAvailable = false; // Always false - using local storage
        this.retryCount = 0;
        this.maxRetries = 0; // No retries - database disabled
        this.retryDelay = 0;
        this.isRailway = false;
        this.init();
    }

    async init() {
        console.log('💾 Database system disabled - using local file storage only');
        console.log('✅ Local file storage initialized');
        // No database connection - only local storage
    }

    async connectWithRetry() {
        // Database connection disabled - using local file storage only
        console.log('💾 MariaDB database system has been disabled');
        console.log('✅ Using local file storage for all data');
        this.isAvailable = false;
        return;
    }

    async createDatabase() {
        // Database creation disabled - using local file storage only
        console.log('💾 Database creation skipped - using local file storage');
        return;
    }

    async createTables() {
        // Table creation disabled - using local file storage only
        console.log('💾 Table creation skipped - using local file storage');
        return;
    }

    async createDefaultAdmin() {
        // Default admin creation disabled - handled by local auth system
        console.log('💾 Default admin creation skipped - handled by local authentication');
        return;
    }

    async getConnection() {
        throw new Error('Database connection disabled - using local file storage only');
    }

    async query(sql, params = []) {
        throw new Error('Database queries disabled - using local file storage only');
    }

    async cleanup() {
        console.log('💾 Database cleanup skipped - no database connections to close');
        return;
    }
}

module.exports = new Database();