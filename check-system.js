#!/usr/bin/env node

/**
 * System Check Script for WhatsApp Sender
 * Checks for required dependencies and system configuration
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 WhatsApp Sender - System Check');
console.log('================================\n');

let allChecksPass = true;

// Check Node.js version
function checkNodeVersion() {
    console.log('📋 Checking Node.js version...');
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
    
    if (majorVersion >= 14) {
        console.log(`✅ Node.js ${nodeVersion} (OK)\n`);
    } else {
        console.log(`❌ Node.js ${nodeVersion} (Requires v14 or higher)\n`);
        allChecksPass = false;
    }
}

// Check Chrome/Chromium installation
function checkChrome() {
    console.log('🌐 Checking Chrome/Chromium installation...');
    
    const possiblePaths = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    
    let chromeFound = false;
    let chromePath = '';
    
    for (const chromePath of possiblePaths) {
        if (fs.existsSync(chromePath)) {
            chromeFound = true;
            chromePath = chromePath;
            break;
        }
    }
    
    if (chromeFound) {
        console.log(`✅ Chrome found at: ${chromePath}`);
        console.log(`💡 Set PUPPETEER_EXECUTABLE_PATH=${chromePath}\n`);
        
        // Set environment variable if not already set
        if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
            process.env.PUPPETEER_EXECUTABLE_PATH = chromePath;
        }
    } else {
        console.log('❌ Chrome/Chromium not found in standard locations');
        console.log('📥 Please install Google Chrome or Chromium:');
        console.log('   Ubuntu/Debian: sudo apt-get install google-chrome-stable');
        console.log('   CentOS/RHEL: sudo yum install google-chrome-stable');
        console.log('   macOS: brew install --cask google-chrome');
        console.log('   Windows: Download from https://www.google.com/chrome/\n');
        allChecksPass = false;
    }
}

// Check system dependencies for Linux
function checkLinuxDependencies() {
    if (process.platform !== 'linux') {
        return;
    }
    
    console.log('🐧 Checking Linux system dependencies...');
    
    const requiredPackages = [
        'libxss1',
        'libgconf-2-4',
        'libxrandr2',
        'libasound2',
        'libpangocairo-1.0-0',
        'libatk1.0-0',
        'libcairo-gobject2',
        'libgtk-3-0',
        'libgdk-pixbuf2.0-0'
    ];
    
    const missingPackages = [];
    
    for (const pkg of requiredPackages) {
        try {
            execSync(`dpkg -l | grep ${pkg}`, { stdio: 'pipe' });
        } catch (error) {
            missingPackages.push(pkg);
        }
    }
    
    if (missingPackages.length === 0) {
        console.log('✅ All required Linux dependencies are installed\n');
    } else {
        console.log('❌ Missing Linux dependencies:');
        console.log(`   ${missingPackages.join(' ')}`);
        console.log('\n📥 Install missing dependencies:');
        console.log(`   sudo apt-get update && sudo apt-get install -y ${missingPackages.join(' ')}\n`);
        allChecksPass = false;
    }
}

// Check memory and disk space
function checkResources() {
    console.log('💾 Checking system resources...');
    
    const totalMemory = require('os').totalmem();
    const freeMemory = require('os').freemem();
    const memoryGB = Math.round(totalMemory / 1024 / 1024 / 1024 * 100) / 100;
    const freeMemoryGB = Math.round(freeMemory / 1024 / 1024 / 1024 * 100) / 100;
    
    console.log(`   Total Memory: ${memoryGB} GB`);
    console.log(`   Free Memory: ${freeMemoryGB} GB`);
    
    if (totalMemory < 1024 * 1024 * 1024) {
        console.log('⚠️  Warning: Less than 1GB RAM detected. Each WhatsApp device uses ~100-200MB');
        console.log('   Recommend at least 2GB RAM for stable operation\n');
    } else {
        console.log('✅ Sufficient memory available\n');
    }
}

// Check required directories
function checkDirectories() {
    console.log('📁 Checking required directories...');
    
    const requiredDirs = [
        '.wwebjs_auth',
        'uploads'
    ];
    
    for (const dir of requiredDirs) {
        const dirPath = path.join(__dirname, dir);
        if (!fs.existsSync(dirPath)) {
            console.log(`📂 Creating directory: ${dir}`);
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }
    
    console.log('✅ Required directories are ready\n');
}

// Check environment variables
function checkEnvironment() {
    console.log('🔧 Checking environment configuration...');
    
    const envVars = {
        'NODE_ENV': process.env.NODE_ENV || 'development',
        'PORT': process.env.PORT || '3001',
        'PUPPETEER_EXECUTABLE_PATH': process.env.PUPPETEER_EXECUTABLE_PATH || 'auto-detect',
        'SESSION_TIMEOUT': process.env.SESSION_TIMEOUT || '1800000 (30 min)',
        'MAX_FILE_SIZE': process.env.MAX_FILE_SIZE || '10485760 (10MB)'
    };
    
    console.log('   Environment Variables:');
    Object.entries(envVars).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`);
    });
    
    console.log('\n💡 You can set custom values in a .env file\n');
}

// Provide optimization recommendations
function provideRecommendations() {
    console.log('🚀 Performance Recommendations:');
    console.log('================================');
    console.log('1. Use SSD storage for better performance');
    console.log('2. Allocate at least 2GB RAM for production use');
    console.log('3. Limit concurrent WhatsApp devices based on available memory');
    console.log('4. Use process manager like PM2 for production deployment');
    console.log('5. Set up proper monitoring and logging');
    console.log('6. Configure firewall to allow necessary ports');
    console.log('7. Use HTTPS in production with proper SSL certificates\n');
}

// Main execution
async function main() {
    try {
        checkNodeVersion();
        checkChrome();
        checkLinuxDependencies();
        checkResources();
        checkDirectories();
        checkEnvironment();
        
        if (allChecksPass) {
            console.log('🎉 All system checks passed! You can start the application.\n');
            console.log('🚀 To start the application:');
            console.log('   Development: npm run dev');
            console.log('   Production:  npm start\n');
        } else {
            console.log('❌ Some system checks failed. Please fix the issues above before starting.\n');
            process.exit(1);
        }
        
        provideRecommendations();
        
    } catch (error) {
        console.error('❌ System check failed:', error.message);
        process.exit(1);
    }
}

main();