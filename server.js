const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));
app.use(express.json());

// ===== STUDENT DATABASE (Matches your Arduino code) =====
const students = {
    "01:02:03:04": { 
        name: "Robel Desalegn", 
        first: "Robel", 
        present: false, 
        time: null 
    },
    "11:22:33:44": { 
        name: "Paulos Elias", 
        first: "Paulos", 
        present: false, 
        time: null 
    },
    "55:66:77:88": { 
        name: "Redeat Birhane", 
        first: "Redeat", 
        present: false, 
        time: null 
    },
    "AA:BB:CC:DD": { 
        name: "Rediet Geremew", 
        first: "Rediet", 
        present: false, 
        time: null 
    }
};

// ===== CARD DATABASE (Card ID -> UID mapping) =====
const cards = {
    "card_robel": "01:02:03:04",
    "card_paulos": "11:22:33:44",
    "card_redeat": "55:66:77:88",
    "card_rediet": "AA:BB:CC:DD",
    "card_unknown": "FF:FF:FF:FF"
};

// ===== SYSTEM STATE =====
let attendanceLog = [];
let currentLCD = { line1: "Attendance Sys", line2: "Tap a card" };

// ===== HELPER FUNCTIONS =====
function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function logEvent(status, uid, name) {
    const timestamp = getTimestamp();
    const entry = { 
        id: attendanceLog.length + 1, 
        timestamp, 
        status, 
        uid, 
        name 
    };
    attendanceLog.unshift(entry);
    
    // Keep only last 50 entries
    if (attendanceLog.length > 50) attendanceLog.pop();
    
    // Save to file
    const logLine = `[${timestamp}] ${status} | ${uid} | ${name}\n`;
    fs.appendFileSync('attendance_log.txt', logLine);
    
    // Send real-time update to all connected clients
    io.emit('log-update', entry);
    return entry;
}

function flashLED(color) {
    io.emit('led-flash', { color: color });
}

function updateLCD(line1, line2) {
    currentLCD = { line1, line2 };
    io.emit('lcd-update', currentLCD);
}

function getPresentCount() {
    return Object.values(students).filter(s => s.present).length;
}

function broadcastStatus() {
    io.emit('status-update', {
        students: students,
        presentCount: getPresentCount(),
        totalStudents: Object.keys(students).length
    });
}

// ===== CARD PROCESSING (Matches Arduino logic) =====
function processCardTap(cardId) {
    const timestamp = getTimestamp();
    const uid = cards[cardId] || "FF:FF:FF:FF";
    
    // Case 1: Unknown card
    if (uid === "FF:FF:FF:FF") {
        updateLCD("Access Denied!", "Unknown Card");
        logEvent("DENIED", uid, "UNKNOWN");
        flashLED("red");
        return { success: false, message: "Unknown card" };
    }
    
    // Case 2: Card not registered in student database
    const student = students[uid];
    if (!student) {
        updateLCD("Access Denied!", "Not Registered");
        logEvent("DENIED", uid, "UNKNOWN");
        flashLED("red");
        return { success: false, message: "Card not registered" };
    }
    
    // Case 3: First time check-in
    if (!student.present) {
        student.present = true;
        student.time = timestamp;
        updateLCD("Access Granted!", `Hi, ${student.first}!`);
        logEvent("GRANTED", uid, student.name);
        flashLED("green");
        broadcastStatus();
        return { 
            success: true, 
            message: `Welcome ${student.first}!`, 
            presentCount: getPresentCount() 
        };
    } 
    // Case 4: Already checked in
    else {
        updateLCD("Welcome Back!", `${student.first} ✓`);
        logEvent("ALREADY", uid, student.name);
        flashLED("green");
        return { 
            success: true, 
            message: `Welcome back ${student.first}!` 
        };
    }
}

// ===== SYSTEM FUNCTIONS =====
function resetAttendance() {
    Object.keys(students).forEach(uid => {
        students[uid].present = false;
        students[uid].time = null;
    });
    updateLCD("Attendance Sys", "Reset Complete");
    logEvent("SYSTEM", "---", "Attendance Reset");
    flashLED("red");
    broadcastStatus();
    return getPresentCount();
}

function clearLog() {
    attendanceLog = [];
    fs.writeFileSync('attendance_log.txt', '');
    io.emit('log-cleared');
}

// ===== API ROUTES =====
app.get('/api/status', (req, res) => {
    res.json({
        students: students,
        logs: attendanceLog.slice(0, 20),
        lcd: currentLCD,
        presentCount: getPresentCount(),
        totalStudents: Object.keys(students).length
    });
});

app.post('/api/tap', (req, res) => {
    const { card_id } = req.body;
    const result = processCardTap(card_id);
    res.json(result);
});

app.post('/api/reset', (req, res) => {
    const count = resetAttendance();
    res.json({ presentCount: count });
});

app.post('/api/clear_log', (req, res) => {
    clearLog();
    res.json({ success: true });
});

// ===== SOCKET.IO CONNECTION =====
io.on('connection', (socket) => {
    console.log('📱 Client connected to dashboard');
    
    // Send initial data to new client
    socket.emit('status-update', {
        students: students,
        presentCount: getPresentCount(),
        totalStudents: Object.keys(students).length
    });
    
    socket.emit('lcd-update', currentLCD);
    
    // Send last 20 logs
    attendanceLog.slice(0, 20).forEach(log => {
        socket.emit('log-update', log);
    });
    
    socket.on('disconnect', () => {
        console.log('📱 Client disconnected');
    });
});

// ===== START SERVER =====
const PORT = 3000;
server.listen(PORT, () => {
    console.log('\n========================================');
    console.log('🎫 RFID Attendance Dashboard Ready!');
    console.log('========================================');
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log('📋 Tap cards on the web interface');
    console.log('========================================\n');
});