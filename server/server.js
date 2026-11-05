/**
 * ============================================================
 *  SERVIDOR DE CHAT EN TIEMPO REAL - WebSocket + Firebase + JWT
 * ============================================================
 *
 *  Arquitectura:
 *    - Express.js gestiona el servidor HTTP y sirve archivos estaticos.
 *    - Socket.IO establece la comunicacion bidireccional en tiempo real.
 *    - Firebase Admin SDK verifica los tokens de autenticacion.
 *    - JWT (jsonwentoken) firma tokens propios tras verificar Firebase.
 *    - Firestore persiste los mensajes del chat en una base de datos.
 *    - Las variables de entorno se cargan desde .env (dotenv).
 *    - CORS valida que solo clientes de dominios autorizados se conecten.
 *
 *  Flujo de autenticacion:
 *    1. El cliente se autentica con Firebase Auth (email/password).
 *    2. El cliente obtiene un Firebase ID Token.
 *    3. El cliente envia el token al endpoint POST /api/auth/verify.
 *    4. El servidor verifica el token con firebase-admin.
 *    5. El servidor firma un JWT propio (con JWT_SECRET) y lo devuelve.
 *    6. El cliente usa ese JWT para conectarse a Socket.IO (auth).
 *    7. El middleware de Socket.IO verifica el JWT en cada conexion.
 *
 *  Eventos de Socket.IO:
 *    connection, disconnect, chat-message, user-joined, user-left,
 *    users-count, users-list, typing, stop-typing
 *
 *  Seguridad:
 *    - Validacion de mensajes en servidor (obligatoria).
 *    - Escapado HTML para prevenir inyeccion.
 *    - JWT verificado en cada conexion Socket.IO.
 *    - CORS restringido a dominios autorizados en .env.
 *    - No se confia en los datos del cliente.
 * ============================================================
 */

// ---------------------------------------------------------
//  Cargar variables de entorno desde .env
//  Debe ser lo PRIMERO que se ejecute.
// ---------------------------------------------------------
require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const jwt = require('jsonwebtoken');
const cors = require('cors');

// ---------------------------------------------------------
//  Inicializar Firebase Admin SDK
// ---------------------------------------------------------
const admin = require('firebase-admin');

/**
 * Inicializa firebase-admin con las credenciales desde .env.
 * Soporta dos metodos:
 *   A) Variables individuales (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)
 *   B) Ruta a archivo JSON (FIREBASE_SERVICE_ACCOUNT_PATH)
 */
function initFirebaseAdmin() {
    // Metodo B: ruta a archivo JSON
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(path.resolve(serviceAccountPath));
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('[Firebase] Inicializado desde archivo:', serviceAccountPath);
        return;
    }

    // Metodo A: variables individuales
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

    // Verificar que las credenciales no sean los valores placeholder por defecto
    const isPlaceholder = (
        projectId === 'tu-project-id-firebase' ||
        clientEmail === 'firebase-adminsdk-xxxxx@tu-project-id.iam.gserviceaccount.com' ||
        !privateKeyRaw || privateKeyRaw.includes('MIIEvQIBADANBgkqhkiG')
    );

    if (projectId && clientEmail && privateKeyRaw && !isPlaceholder) {
        const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: projectId,
                clientEmail: clientEmail,
                privateKey: privateKey
            })
        });
        console.log('[Firebase] Inicializado desde variables de entorno.');
        return;
    }

    // Si no hay credenciales reales, no inicializar
    console.warn('[Firebase] ADVERTENCIA: No se encontraron credenciales validas.');
    console.warn('[Firebase] Configura FIREBASE_* en .env con tus credenciales reales.');
    console.warn('[Firebase] El servidor funcionara en modo demo.');
    // Lanzar para que el caller sepa que Firebase no esta disponible
    throw new Error('Credenciales de Firebase no configuradas.');
}

const fs = require('fs');

let firebaseInitialized = false;

try {
    initFirebaseAdmin();
    firebaseInitialized = true;
} catch (e) {
    console.warn('[Firebase] No se pudo inicializar:', e.message);
    console.warn('[Firebase] El servidor funcionara en modo demo (sin Firebase Auth ni Firestore).');
}

/**
 * Obtiene la instancia de Firestore.
 * Si firebase-admin no se inicializo, retorna null.
 */
let db = null;
if (firebaseInitialized) {
    try {
        db = admin.firestore();
        console.log('[Firestore] Conectado.');
    } catch (e) {
        console.warn('[Firestore] No disponible:', e.message);
    }
}

/**
 * Verifica si Firebase Admin esta disponible.
 */
function isFirebaseAvailable() {
    return firebaseInitialized;
}

// ---------------------------------------------------------
//  Configuracion desde variables de entorno
// ---------------------------------------------------------
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map(origin => origin.trim());
const MESSAGES_COLLECTION = process.env.FIRESTORE_MESSAGES_COLLECTION || 'messages';

// ---------------------------------------------------------
//  Configuracion del servidor HTTP con Express
// ---------------------------------------------------------
const app = express();
const httpServer = createServer(app);

// Middleware: parsear JSON en el body de las peticiones
app.use(express.json());

// Middleware CORS para Express (valida dominios autorizados)
app.use(cors({
    origin: function (origin, callback) {
        // Permitir peticiones sin origin (curl, postman, misma maquina)
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Origen rechazado: ${origin}`);
            callback(new Error('No autorizado por CORS'));
        }
    },
    methods: ['GET', 'POST']
}));

// Servir archivos estaticos desde la carpeta /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------
//  ENDPOINT: /api/config
//  Devuelve la configuracion PUBLICA de Firebase al cliente.
//  Estos valores no son secretos (van en el HTML del cliente).
// ---------------------------------------------------------
app.get('/api/config', (req, res) => {
    res.json({
        firebase: {
            apiKey: process.env.FIREBASE_API_KEY || '',
            authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
            projectId: process.env.FIREBASE_PROJECT_ID_CLIENT || '',
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
            appId: process.env.FIREBASE_APP_ID || ''
        },
        firebaseEnabled: isFirebaseAvailable()
    });
});

// ---------------------------------------------------------
//  ENDPOINT: POST /api/auth/verify
//  Recibe un Firebase ID Token del cliente, lo verifica con
//  firebase-admin y, si es valido, firma y devuelve un JWT propio.
//
//  Request body: { "firebaseToken": "eyJ..." }
//  Response:     { "jwt": "eyJ...", "username": "...", "uid": "..." }
// ---------------------------------------------------------
app.post('/api/auth/verify', async (req, res) => {
    const { firebaseToken } = req.body;

    if (!firebaseToken) {
        return res.status(400).json({ error: 'Token no proporcionado.' });
    }

    // Si Firebase no esta configurado, modo demo (sin auth real)
    if (!isFirebaseAvailable()) {
        // Modo demo: el "token" es el nombre de usuario directamente
        const username = firebaseToken.trim();
        if (username.length < 2) {
            return res.status(400).json({ error: 'Nombre de usuario demasiado corto.' });
        }

        const token = jwt.sign(
            { uid: 'demo-' + username, username: username, firebase: false },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );
        console.log(`[AUTH] JWT demo emitido para "${username}"`);
        return res.json({ jwt: token, username: username, uid: 'demo-' + username });
    }

    // Verificar el Firebase ID Token con firebase-admin
    try {
        const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
        const uid = decodedToken.uid;

        // Obtener el usuario de Firebase Auth para su nombre/email
        const userRecord = await admin.auth().getUser(uid);
        const username = userRecord.displayName || userRecord.email || uid;

        // Firmar un JWT propio con el uid y username
        const token = jwt.sign(
            { uid: uid, username: username, email: userRecord.email, firebase: true },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        console.log(`[AUTH] JWT emitido para "${username}" (${uid})`);
        return res.json({ jwt: token, username: username, uid: uid });
    } catch (error) {
        console.error('[AUTH] Error verificando Firebase token:', error.message);
        return res.status(401).json({ error: 'Token de Firebase invalido.' });
    }
});

// ---------------------------------------------------------
//  ENDPOINT: GET /api/messages
//  Devuelve los ultimos N mensajes almacenados en Firestore.
//  Requiere JWT valido en el header Authorization: Bearer <jwt>
// ---------------------------------------------------------
app.get('/api/messages', async (req, res) => {
    // Verificar JWT
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'JWT invalido o expirado.' });
    }

    // Si Firestore no esta disponible, devolver array vacio
    if (!db) {
        return res.json({ messages: [] });
    }

    try {
        // Obtener los ultimos 50 mensajes ordenados por timestamp
        const snapshot = await db.collection(MESSAGES_COLLECTION)
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();

        const messages = [];
        snapshot.forEach(doc => {
            messages.push(doc.data());
        });

        // Invertir para mostrar en orden cronologico (mas viejo primero)
        messages.reverse();

        return res.json({ messages });
    } catch (error) {
        console.error('[Firestore] Error al obtener mensajes:', error.message);
        return res.status(500).json({ error: 'Error al obtener mensajes.' });
    }
});

// Ruta principal: sirve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ---------------------------------------------------------
//  Configuracion de Socket.IO con CORS y autenticacion JWT
// ---------------------------------------------------------
const io = new Server(httpServer, {
    cors: {
        // Solo permitir conexiones desde los dominios autorizados en .env
        origin: function (origin, callback) {
            if (!origin) return callback(null, true);
            if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                console.warn(`[Socket.IO CORS] Origen rechazado: ${origin}`);
                callback(new Error('No autorizado por CORS'));
            }
        },
        methods: ['GET', 'POST']
    }
});

// ---------------------------------------------------------
//  MIDDLEWARE DE AUTENTICACION DE SOCKET.IO
//  Verifica el JWT en cada conexion. Si el token es invalido,
//  la conexion se rechaza.
// ---------------------------------------------------------
io.use((socket, next) => {
    // El JWT se envia en socket.handshake.auth.token
    const token = socket.handshake.auth && socket.handshake.auth.token;

    if (!token) {
        return next(new Error('Autenticacion requerida: no se proporciono token.'));
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        // Adjuntar los datos del usuario al socket para uso posterior
        socket.user = {
            uid: decoded.uid,
            username: decoded.username,
            email: decoded.email || '',
            firebase: decoded.firebase
        };
        next();
    } catch (err) {
        console.warn(`[Socket.IO] JWT invalido: ${err.message}`);
        next(new Error('Token invalido o expirado.'));
    }
});

// ---------------------------------------------------------
//  Almacenamiento en memoria de usuarios conectados
// ---------------------------------------------------------
const connectedUsers = new Map();

// ---------------------------------------------------------
//  Constantes de validacion
// ---------------------------------------------------------
const MAX_MESSAGE_LENGTH = 500;
const MAX_USERNAME_LENGTH = 20;
const MIN_USERNAME_LENGTH = 2;

const USER_COLORS = [
    '#16a085', '#2980b9', '#8e44ad', '#e67e22',
    '#c0392b', '#d35400', '#27ae60', '#2c3e50'
];

function assignUserColor() {
    return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function validateUsername(username) {
    if (typeof username !== 'string') {
        return { valid: false, error: 'El nombre de usuario debe ser texto.' };
    }
    const trimmed = username.trim();
    if (trimmed.length < MIN_USERNAME_LENGTH) {
        return { valid: false, error: `El nombre debe tener al menos ${MIN_USERNAME_LENGTH} caracteres.` };
    }
    if (trimmed.length > MAX_USERNAME_LENGTH) {
        return { valid: false, error: `El nombre no puede exceder ${MAX_USERNAME_LENGTH} caracteres.` };
    }
    return { valid: true };
}

function validateMessage(message) {
    if (typeof message !== 'string') {
        return { valid: false, error: 'El mensaje debe ser texto.' };
    }
    const trimmed = message.trim();
    if (trimmed.length === 0) {
        return { valid: false, error: 'El mensaje no puede estar vacio.' };
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
        return { valid: false, error: `El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres.` };
    }
    return { valid: true };
}

function getTimestamp() {
    return new Date().toISOString();
}

function broadcastUsersCount() {
    io.emit('users-count', { count: connectedUsers.size });
}

function broadcastUsersList() {
    const usersList = Array.from(connectedUsers.values()).map(u => ({
        username: u.username,
        color: u.color
    }));
    io.emit('users-list', { users: usersList });
}

/**
 * Guarda un mensaje en Firestore (si esta disponible).
 * Es async pero no bloquea la distribucion del mensaje.
 * @param {Object} messageData
 */
async function saveMessageToFirestore(messageData) {
    if (!db || !firebaseInitialized) return;

    try {
        await db.collection(MESSAGES_COLLECTION).add({
            type: messageData.type,
            username: messageData.username,
            color: messageData.color,
            message: messageData.message,
            timestamp: messageData.timestamp,
            uid: messageData.uid || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('[Firestore] Mensaje guardado.');
    } catch (error) {
        console.error('[Firestore] Error al guardar mensaje:', error.message);
    }
}

// ===============================================================
//  GESTION DE EVENTOS DE SOCKET.IO
// ===============================================================

io.on('connection', (socket) => {
    // El middleware ya verifico el JWT y adjunto socket.user
    const userUid = socket.user.uid;
    const userUsername = socket.user.username;

    console.log(`[CONEXION] Cliente autenticado: ${userUsername} (${socket.id})`);

    // -------------------------------------------------------
    //  Evento: user-joined
    //  El cliente confirma su entrada al chat.
    //  El servidor ya conoce al usuario (desde el JWT).
    // -------------------------------------------------------
    socket.on('user-joined', () => {
        // El username viene del JWT, no del cliente
        const username = userUsername;

        const validation = validateUsername(username);
        if (!validation.valid) {
            socket.emit('join-error', { error: validation.error });
            return;
        }

        // Registrar al usuario en memoria
        const userColor = assignUserColor();
        connectedUsers.set(socket.id, {
            id: socket.id,
            uid: userUid,
            username: username,
            color: userColor
        });

        console.log(`[USUARIO] "${username}" se ha unido al chat (${socket.id})`);

        // Confirmar al cliente
        socket.emit('join-success', {
            username: username,
            color: userColor
        });

        // Notificar a los demas
        socket.broadcast.emit('user-joined', {
            username: username,
            timestamp: getTimestamp()
        });

        broadcastUsersCount();
        broadcastUsersList();
    });

    // -------------------------------------------------------
    //  Evento: chat-message
    //  El cliente envia un mensaje. El servidor valida, escapa,
    //  guarda en Firestore y distribuye.
    // -------------------------------------------------------
    socket.on('chat-message', (data) => {
        const user = connectedUsers.get(socket.id);
        if (!user) {
            socket.emit('message-error', { error: 'Debes registrarte antes de enviar mensajes.' });
            return;
        }

        if (!data || typeof data !== 'object') {
            socket.emit('message-error', { error: 'Formato de mensaje invalido.' });
            return;
        }

        const validation = validateMessage(data.message);
        if (!validation.valid) {
            socket.emit('message-error', { error: validation.error });
            return;
        }

        const escapedMessage = escapeHtml(data.message.trim());

        const messageData = {
            type: 'message',
            username: user.username,
            color: user.color,
            message: escapedMessage,
            timestamp: getTimestamp(),
            uid: user.uid
        };

        console.log(`[MENSAJE] ${user.username}: ${escapedMessage.substring(0, 50)}...`);

        // Guardar en Firestore (no bloquea la distribucion)
        saveMessageToFirestore(messageData);

        // Distribuir a todos los clientes
        io.emit('chat-message', messageData);
    });

    // -------------------------------------------------------
    //  Evento: typing / stop-typing
    // -------------------------------------------------------
    socket.on('typing', () => {
        const user = connectedUsers.get(socket.id);
        if (!user) return;
        socket.broadcast.emit('typing', {
            username: user.username,
            color: user.color
        });
    });

    socket.on('stop-typing', () => {
        const user = connectedUsers.get(socket.id);
        if (!user) return;
        socket.broadcast.emit('stop-typing', {
            username: user.username
        });
    });

    // -------------------------------------------------------
    //  Evento: disconnect
    // -------------------------------------------------------
    socket.on('disconnect', (reason) => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            console.log(`[DESCONEXION] "${user.username}" ha salido (${socket.id}). Razon: ${reason}`);
            socket.broadcast.emit('user-left', {
                username: user.username,
                timestamp: getTimestamp()
            });
            connectedUsers.delete(socket.id);
            broadcastUsersCount();
            broadcastUsersList();
            socket.broadcast.emit('stop-typing', { username: user.username });
        }
        console.log(`[CONEXION] Cliente desconectado: ${socket.id}`);
    });

    socket.on('error', (err) => {
        console.error(`[ERROR] Socket ${socket.id}:`, err.message);
        const user = connectedUsers.get(socket.id);
        if (user) {
            connectedUsers.delete(socket.id);
            broadcastUsersCount();
            broadcastUsersList();
        }
    });
});

// ===============================================================
//  UTILIDAD: Obtener IPs locales
// ===============================================================
function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push({ name, address: iface.address });
            }
        }
    }
    return ips;
}

// ===============================================================
//  INICIAR SERVIDOR
// ===============================================================
httpServer.listen(PORT, () => {
    const localIPs = getLocalIPs();

    console.log('================================================');
    console.log('  CHATWS - Servidor iniciado');
    console.log(`  Puerto: ${PORT}`);
    console.log('');
    console.log('  Conexion local:');
    console.log(`    http://localhost:${PORT}`);
    console.log('');
    console.log('  Conexion desde otras PCs (misma red):');
    localIPs.forEach(ip => {
        console.log(`    http://${ip.address}:${PORT}  (${ip.name})`);
    });
    console.log('');
    console.log('  Seguridad:');
    console.log(`    Firebase Auth: ${isFirebaseAvailable() ? 'ACTIVO' : 'NO configurado (modo demo)'}`);
    console.log(`    JWT:           ACTIVO (secret: ${JWT_SECRET.substring(0, 8)}...)`);
    console.log(`    CORS:          ${ALLOWED_ORIGINS.length} origen(es) permitido(s)`);
    ALLOWED_ORIGINS.forEach(o => console.log(`                    - ${o}`));
    console.log(`    Firestore:     ${db ? 'ACTIVO' : 'NO configurado'}`);
    console.log('================================================');
});
