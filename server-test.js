const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');

// Initialize Express app and server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

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

// Mock users for testing (replace with database later)
const mockUsers = [
    {
        id: 1,
        username: 'admin',
        email: 'admin@example.com',
        fullName: 'Administrator',
        role: 'admin'
    }
];

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    } else {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
};

const requireAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        return next();
    } else {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
};

// Authentication routes (temporary mock implementation)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password, fullName, phone } = req.body;
        
        // Check if user already exists
        const existingUser = mockUsers.find(u => u.username === username || u.email === email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'User with this username or email already exists'
            });
        }
        
        // Create new user
        const newUser = {
            id: mockUsers.length + 1,
            username,
            email,
            fullName: fullName || username,
            phone,
            role: 'user'
        };
        
        mockUsers.push(newUser);
        req.session.user = newUser;
        
        res.json({
            success: true,
            message: 'Registration successful',
            user: newUser
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
        
        // Find user (in real app, verify password)
        const user = mockUsers.find(u => u.username === username || u.email === username);
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password'
            });
        }
        
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
    res.json({
        success: true,
        user: req.session.user
    });
});

// Admin routes
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    res.json({
        success: true,
        users: mockUsers
    });
});

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

// Socket.io basic connection
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 WhatsApp Sender Server (Test Mode) running on port ${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} to access the application`);
    console.log(`⚠️  Running in test mode without database`);
});

module.exports = { app, server, io };