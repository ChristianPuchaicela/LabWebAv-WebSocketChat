/* ============================================================
 *  CHATWS - Logica del cliente (JavaScript Vanilla)
 * ============================================================
 *
 *  Flujo de autenticacion:
 *    1. El usuario se autentica con Firebase (email/password)
 *       o entra en modo demo (sin Firebase).
 *    2. El cliente obtiene un Firebase ID Token.
 *    3. El cliente envia el token a POST /api/auth/verify.
 *    4. El servidor verifica el token y devuelve un JWT.
 *    5. El cliente guarda el JWT y se conecta a Socket.IO
 *       pasando el JWT en socket.handshake.auth.token.
 *    6. El middleware de Socket.IO verifica el JWT.
 *
 *  Responsabilidades del cliente:
 *    - Autenticar al usuario con Firebase Auth.
 *    - Intercambiar el Firebase token por un JWT del servidor.
 *    - Conectarse a Socket.IO con el JWT.
 *    - Enviar/recibir mensajes en tiempo real.
 *    - Gestionar UI (tema, typing, validacion, etc.).
 * ============================================================ */

(function () {
    'use strict';

    // ============================================================
    //  CONSTANTES
    // ============================================================
    const MAX_MESSAGE_LENGTH = 500;
    const TYPING_DEBOUNCE_MS = 1500;
    const STORAGE_KEY_THEME = 'chatws-theme';
    const STORAGE_KEY_JWT = 'chatws-jwt';
    const STORAGE_KEY_USER = 'chatws-username';

    // ============================================================
    //  REFERENCIAS AL DOM
    // ============================================================
    // Login screen
    const loginScreen = document.getElementById('login-screen');
    const chatScreen = document.getElementById('chat-screen');
    const loginError = document.getElementById('login-error');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginBtn = document.getElementById('login-btn');
    const registerBtn = document.getElementById('register-btn');
    const demoBtn = document.getElementById('demo-btn');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');

    // Chat screen
    const messagesContainer = document.getElementById('messages-container');
    const emptyState = document.getElementById('empty-state');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const charCounter = document.getElementById('char-counter');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const usersCountEl = document.getElementById('users-count');
    const usersListEl = document.getElementById('users-list');
    const themeToggle = document.getElementById('theme-toggle');
    const iconSun = document.getElementById('icon-sun');
    const iconMoon = document.getElementById('icon-moon');
    const typingIndicator = document.getElementById('typing-indicator');
    const typingText = document.getElementById('typing-text');
    const reconnectBanner = document.getElementById('reconnect-banner');
    const logoutBtn = document.getElementById('logout-btn');

    // ============================================================
    //  ESTADO DE LA APLICACION
    // ============================================================
    let socket = null;
    let currentUsername = '';
    let currentJwt = null;
    let isRegistered = false;
    let isConnected = false;
    let firebaseEnabled = false;
    let firebaseApp = null;

    let typingTimeout = null;
    let isTyping = false;
    const typingUsers = new Map();

    // ============================================================
    //  GESTION DEL TEMA (CLARO / OSCURO)
    // ============================================================
    function loadTheme() {
        const savedTheme = localStorage.getItem(STORAGE_KEY_THEME);
        if (savedTheme) {
            applyTheme(savedTheme);
        } else {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            applyTheme(prefersDark ? 'dark' : 'light');
        }
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        if (theme === 'dark') {
            iconSun.style.display = 'inline';
            iconMoon.style.display = 'none';
        } else {
            iconSun.style.display = 'none';
            iconMoon.style.display = 'inline';
        }
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
        localStorage.setItem(STORAGE_KEY_THEME, newTheme);
    }

    themeToggle.addEventListener('click', toggleTheme);

    // ============================================================
    //  INICIALIZACION DE FIREBASE (cliente)
    //  La configuracion se obtiene del servidor en /api/config
    //  para no hardcodear las claves en el HTML.
    // ============================================================
    async function initFirebase() {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();

            firebaseEnabled = config.firebaseEnabled;

            if (firebaseEnabled && config.firebase.apiKey) {
                // Inicializar Firebase con la config del servidor
                firebaseApp = firebase.initializeApp(config.firebase);
                console.log('[Firebase] SDK inicializado.');
            } else {
                console.log('[Firebase] No configurado. Funcionando en modo demo.');
            }
        } catch (err) {
            console.warn('[Firebase] No se pudo inicializar:', err.message);
            firebaseEnabled = false;
        }
    }

    // ============================================================
    //  AUTENTICACION CON FIREBASE + INTERCAMBIO POR JWT
    // ============================================================

    /**
     * Autentica al usuario con Firebase Auth (email/password).
     * @param {string} email
     * @param {string} password
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async function loginWithFirebase(email, password) {
        try {
            // Firebase Auth: iniciar sesion
            const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // Obtener el Firebase ID Token
            const firebaseToken = await user.getIdToken();

            // Intercambiar el Firebase token por un JWT del servidor
            const result = await exchangeTokenForJWT(firebaseToken);
            if (result.error) {
                return { success: false, error: result.error };
            }

            currentJwt = result.jwt;
            currentUsername = result.username;

            // Guardar en LocalStorage para persistencia entre recargas
            localStorage.setItem(STORAGE_KEY_JWT, currentJwt);
            localStorage.setItem(STORAGE_KEY_USER, currentUsername);

            return { success: true };
        } catch (err) {
            console.error('[Auth] Error de login Firebase:', err.message);
            // Traducir errores comunes de Firebase
            let msg = err.message;
            if (err.code === 'auth/wrong-password') msg = 'Contrasena incorrecta.';
            else if (err.code === 'auth/user-not-found') msg = 'No existe una cuenta con ese correo.';
            else if (err.code === 'auth/invalid-email') msg = 'Correo electronico invalido.';
            else if (err.code === 'auth/too-many-requests') msg = 'Demasiados intentos. Intenta mas tarde.';
            return { success: false, error: msg };
        }
    }

    /**
     * Registra un nuevo usuario en Firebase Auth.
     * @param {string} displayName
     * @param {string} email
     * @param {string} password
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async function registerWithFirebase(displayName, email, password) {
        try {
            const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // Actualizar el perfil con el nombre para mostrar
            if (displayName) {
                await user.updateProfile({ displayName: displayName });
            }

            // Obtener Firebase ID Token
            const firebaseToken = await user.getIdToken();

            // Intercambiar por JWT
            const result = await exchangeTokenForJWT(firebaseToken);
            if (result.error) {
                return { success: false, error: result.error };
            }

            currentJwt = result.jwt;
            currentUsername = displayName || result.username;

            localStorage.setItem(STORAGE_KEY_JWT, currentJwt);
            localStorage.setItem(STORAGE_KEY_USER, currentUsername);

            return { success: true };
        } catch (err) {
            console.error('[Auth] Error de registro Firebase:', err.message);
            let msg = err.message;
            if (err.code === 'auth/email-already-in-use') msg = 'Ya existe una cuenta con ese correo.';
            else if (err.code === 'auth/weak-password') msg = 'La contrasena debe tener al menos 6 caracteres.';
            return { success: false, error: msg };
        }
    }

    /**
     * Envia el Firebase ID Token al servidor y obtiene un JWT.
     * POST /api/auth/verify
     * @param {string} firebaseToken
     * @returns {Promise<{jwt?: string, username?: string, error?: string}>}
     */
    async function exchangeTokenForJWT(firebaseToken) {
        try {
            const response = await fetch('/api/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ firebaseToken: firebaseToken })
            });
            const data = await response.json();
            if (data.error) {
                return { error: data.error };
            }
            return { jwt: data.jwt, username: data.username };
        } catch (err) {
            console.error('[Auth] Error al intercambiar token:', err.message);
            return { error: 'No se pudo conectar con el servidor.' };
        }
    }

    /**
     * Modo demo: no usa Firebase. Envia el nombre de usuario
     * directamente al endpoint /api/auth/verify como "firebaseToken".
     * El servidor reconoce que Firebase no esta configurado y emite
     * un JWT en modo demo.
     * @param {string} username
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async function loginDemo(username) {
        if (username.length < 2) {
            return { success: false, error: 'El nombre debe tener al menos 2 caracteres.' };
        }
        if (username.length > 20) {
            return { success: false, error: 'El nombre no puede exceder 20 caracteres.' };
        }

        const result = await exchangeTokenForJWT(username);
        if (result.error) {
            return { success: false, error: result.error };
        }

        currentJwt = result.jwt;
        currentUsername = result.username;

        localStorage.setItem(STORAGE_KEY_JWT, currentJwt);
        localStorage.setItem(STORAGE_KEY_USER, currentUsername);

        return { success: true };
    }

    /**
     * Cierra sesion: limpia JWT, desconecta Socket.IO, muestra login.
     */
    async function logout() {
        // Cerrar sesion en Firebase
        if (firebaseEnabled && firebase.auth().currentUser) {
            await firebase.auth().signOut();
        }

        // Desconectar Socket.IO
        if (socket) {
            socket.disconnect();
            socket = null;
        }

        // Limpiar estado
        currentJwt = null;
        currentUsername = '';
        isRegistered = false;
        isConnected = false;

        localStorage.removeItem(STORAGE_KEY_JWT);
        localStorage.removeItem(STORAGE_KEY_USER);

        // Limpiar mensajes del DOM
        messagesContainer.innerHTML = '';
        if (emptyState) {
            emptyState.classList.remove('hidden');
            messagesContainer.appendChild(emptyState);
        }

        // Mostrar login
        chatScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
    }

    // ============================================================
    //  GESTION DE LA CONEXION SOCKET.IO CON JWT
    // ============================================================

    function updateConnectionStatus(state) {
        statusDot.classList.remove('connected', 'disconnected', 'reconnecting');
        switch (state) {
            case 'connected':
                statusDot.classList.add('connected');
                statusText.textContent = 'Conectado';
                isConnected = true;
                reconnectBanner.classList.add('hidden');
                break;
            case 'disconnected':
                statusDot.classList.add('disconnected');
                statusText.textContent = 'Desconectado';
                isConnected = false;
                break;
            case 'reconnecting':
                statusDot.classList.add('reconnecting');
                statusText.textContent = 'Reconectando...';
                isConnected = false;
                reconnectBanner.classList.remove('hidden');
                break;
        }
    }

    /**
     * Inicializa Socket.IO pasando el JWT en auth.
     * El servidor verificara el JWT en el middleware.
     */
    function initSocketConnection() {
        socket = io({
            // Pasar el JWT para autenticar la conexion
            auth: {
                token: currentJwt
            },
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 10000
        });

        // --- Eventos de conexion ---

        socket.on('connect', () => {
            console.log('[Socket.IO] Conectado y autenticado.');
            updateConnectionStatus('connected');
            // Notificar al servidor que el usuario esta listo
            socket.emit('user-joined');
        });

        socket.on('disconnect', (reason) => {
            console.warn('[Socket.IO] Desconectado:', reason);
            updateConnectionStatus('disconnected');
            isRegistered = false;
            if (reason === 'io server disconnect') {
                socket.connect();
            }
        });

        socket.on('connect_error', (err) => {
            console.error('[Socket.IO] Error de conexion:', err.message);
            updateConnectionStatus('reconnecting');
            // Si el error es de autenticacion, volver al login
            if (err.message.includes('Token') || err.message.includes('Autenticacion')) {
                loginError.textContent = 'Sesion expirada. Por favor, inicia sesion de nuevo.';
                logout();
            }
        });

        socket.on('reconnect_attempt', (attemptNumber) => {
            console.log(`[Socket.IO] Intento de reconexion #${attemptNumber}`);
            updateConnectionStatus('reconnecting');
            // Actualizar el JWT si tenemos uno nuevo
            if (currentJwt) {
                socket.auth = { token: currentJwt };
            }
        });

        socket.on('reconnect', (attemptNumber) => {
            console.log(`[Socket.IO] Reconectado tras ${attemptNumber} intentos.`);
            updateConnectionStatus('connected');
        });

        // --- Eventos de registro ---

        socket.on('join-success', (data) => {
            console.log('[Chat] Registro exitoso:', data.username);
            isRegistered = true;
            currentUsername = data.username;
            showChatScreen();
        });

        socket.on('join-error', (data) => {
            console.error('[Chat] Error de registro:', data.error);
            loginError.textContent = data.error;
            logout();
        });

        // --- Eventos de mensajes ---

        socket.on('chat-message', (data) => {
            renderMessage(data);
        });

        socket.on('message-error', (data) => {
            console.warn('[Chat] Mensaje rechazado:', data.error);
            showTemporaryError(data.error);
        });

        // --- Eventos de usuarios ---

        socket.on('user-joined', (data) => {
            renderNotification(`${escapeHtml(data.username)} se ha unido al chat`, data.timestamp);
        });

        socket.on('user-left', (data) => {
            renderNotification(`${escapeHtml(data.username)} ha salido del chat`, data.timestamp);
            removeTypingUser(data.username);
        });

        socket.on('users-count', (data) => {
            usersCountEl.textContent = data.count;
        });

        socket.on('users-list', (data) => {
            renderUsersList(data.users);
        });

        // --- Eventos de escritura ---

        socket.on('typing', (data) => {
            if (data.username !== currentUsername) {
                addTypingUser(data.username);
            }
        });

        socket.on('stop-typing', (data) => {
            removeTypingUser(data.username);
        });
    }

    // ============================================================
    //  CARGAR HISTORIAL DE MENSAJES DESDE FIRESTORE
    // ============================================================

    /**
     * Obtiene los ultimos mensajes desde el servidor (Firestore).
     * Requiere JWT valido.
     */
    async function loadMessageHistory() {
        if (!currentJwt) return;

        try {
            const response = await fetch('/api/messages', {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + currentJwt
                }
            });

            if (!response.ok) {
                console.warn('[Chat] No se pudo cargar el historial.');
                return;
            }

            const data = await response.json();
            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => {
                    renderMessage(msg);
                });
            }
        } catch (err) {
            console.warn('[Chat] Error al cargar historial:', err.message);
        }
    }

    // ============================================================
    //  RENDERIZADO DE LA INTERFAZ
    // ============================================================

    function showChatScreen() {
        loginScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');
        messageInput.focus();
        // Cargar historial de mensajes desde Firestore
        loadMessageHistory();
    }

    function escapeHtml(text) {
        if (typeof text !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatTime(isoTimestamp) {
        try {
            const date = new Date(isoTimestamp);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    function renderMessage(data) {
        if (emptyState && !emptyState.classList.contains('hidden')) {
            emptyState.classList.add('hidden');
        }

        const bubble = document.createElement('div');
        const isSent = data.username === currentUsername;
        bubble.className = `message-bubble ${isSent ? 'sent' : 'received'}`;

        const header = document.createElement('div');
        header.className = 'message-header';

        const usernameSpan = document.createElement('span');
        usernameSpan.className = 'message-username';
        usernameSpan.textContent = data.username;
        if (data.color && !isSent) {
            usernameSpan.style.color = data.color;
        }

        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.textContent = formatTime(data.timestamp);

        header.appendChild(usernameSpan);
        header.appendChild(timeSpan);

        const textPara = document.createElement('div');
        textPara.className = 'message-text';
        textPara.textContent = data.message;

        bubble.appendChild(header);
        bubble.appendChild(textPara);
        messagesContainer.appendChild(bubble);
        scrollToBottom();
    }

    function renderNotification(text, timestamp) {
        if (emptyState && !emptyState.classList.contains('hidden')) {
            emptyState.classList.add('hidden');
        }

        const notif = document.createElement('div');
        notif.className = 'notification';

        const textSpan = document.createElement('span');
        textSpan.innerHTML = text;

        if (timestamp) {
            const timeSpan = document.createElement('span');
            timeSpan.className = 'notif-time';
            timeSpan.textContent = formatTime(timestamp);
            notif.appendChild(textSpan);
            notif.appendChild(timeSpan);
        } else {
            notif.appendChild(textSpan);
        }

        messagesContainer.appendChild(notif);
        scrollToBottom();
    }

    function renderUsersList(users) {
        usersListEl.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.className = 'user-dot';
            dot.style.background = user.color || 'var(--color-acento)';
            const name = document.createElement('span');
            name.textContent = user.username;
            if (user.username === currentUsername) {
                name.textContent += ' (tu)';
                name.style.fontWeight = '700';
            }
            li.appendChild(dot);
            li.appendChild(name);
            usersListEl.appendChild(li);
        });
    }

    function scrollToBottom() {
        const threshold = 100;
        const isNearBottom =
            messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < threshold;
        if (isNearBottom) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    // ============================================================
    //  VALIDACION Y ENVIO DE MENSAJES
    // ============================================================

    function validateMessage() {
        const text = messageInput.value.trim();
        const rawLength = messageInput.value.length;
        if (rawLength === 0 || text.length === 0) {
            return { valid: false, message: '' };
        }
        if (rawLength > MAX_MESSAGE_LENGTH) {
            return { valid: false, message: 'El mensaje supera el limite de 500 caracteres.' };
        }
        return { valid: true, message: text };
    }

    function updateCharCounter() {
        const length = messageInput.value.length;
        charCounter.textContent = `${length} / ${MAX_MESSAGE_LENGTH}`;
        charCounter.classList.remove('warning', 'danger');
        if (length > MAX_MESSAGE_LENGTH) {
            charCounter.classList.add('danger');
        } else if (length > MAX_MESSAGE_LENGTH * 0.8) {
            charCounter.classList.add('warning');
        }
        const validation = validateMessage();
        sendBtn.disabled = !validation.valid || !isConnected;
    }

    function showTemporaryError(message) {
        let errorEl = document.querySelector('.input-error');
        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.className = 'input-error';
            errorEl.style.cssText = 'color: var(--color-error); font-size: 12px; padding: 0 20px 4px; text-align: right;';
            messageInput.parentElement.parentElement.appendChild(errorEl);
        }
        errorEl.textContent = message;
        setTimeout(() => {
            if (errorEl) errorEl.remove();
        }, 3000);
    }

    function sendMessage() {
        if (!isConnected || !isRegistered) {
            showTemporaryError('No hay conexion activa.');
            return;
        }
        const validation = validateMessage();
        if (!validation.valid) {
            if (validation.message) showTemporaryError(validation.message);
            return;
        }
        socket.emit('chat-message', { message: validation.message });
        stopTyping();
        messageInput.value = '';
        updateCharCounter();
        autoResizeTextarea();
        messageInput.focus();
    }

    // ============================================================
    //  INDICADOR DE ESCRITURA
    // ============================================================

    function startTyping() {
        if (!isConnected || !isRegistered) return;
        if (!isTyping) {
            isTyping = true;
            socket.emit('typing');
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => { stopTyping(); }, TYPING_DEBOUNCE_MS);
    }

    function stopTyping() {
        if (!isConnected || !isRegistered) return;
        if (isTyping) {
            isTyping = false;
            socket.emit('stop-typing');
        }
        clearTimeout(typingTimeout);
    }

    function addTypingUser(username) {
        if (typingUsers.has(username)) clearTimeout(typingUsers.get(username));
        const timeoutId = setTimeout(() => {
            typingUsers.delete(username);
            updateTypingIndicator();
        }, 3000);
        typingUsers.set(username, timeoutId);
        updateTypingIndicator();
    }

    function removeTypingUser(username) {
        if (typingUsers.has(username)) {
            clearTimeout(typingUsers.get(username));
            typingUsers.delete(username);
            updateTypingIndicator();
        }
    }

    function updateTypingIndicator() {
        const count = typingUsers.size;
        if (count === 0) {
            typingIndicator.classList.add('hidden');
        } else if (count === 1) {
            const username = typingUsers.keys().next().value;
            typingText.textContent = `${username} esta escribiendo...`;
            typingIndicator.classList.remove('hidden');
        } else {
            const usernames = Array.from(typingUsers.keys());
            typingText.textContent = `${usernames[0]} y ${count - 1} mas estan escribiendo...`;
            typingIndicator.classList.remove('hidden');
        }
    }

    function autoResizeTextarea() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    }

    // ============================================================
    //  EVENT LISTENERS DEL DOM - AUTENTICACION
    // ============================================================

    // Cambiar entre tabs de login y registro
    tabLogin.addEventListener('click', () => {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        loginError.textContent = '';
    });

    tabRegister.addEventListener('click', () => {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        loginError.textContent = '';
    });

    // Formulario de login
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        loginError.textContent = '';
        loginBtn.disabled = true;
        loginBtn.textContent = 'Verificando...';

        let result;
        if (firebaseEnabled) {
            result = await loginWithFirebase(email, password);
        } else {
            // Modo demo: usar el email como nombre
            result = await loginDemo(email.split('@')[0]);
        }

        if (result.success) {
            initSocketConnection();
        } else {
            loginError.textContent = result.error || 'Error al iniciar sesion.';
            loginBtn.disabled = false;
            loginBtn.textContent = 'Iniciar Sesion';
        }
    });

    // Formulario de registro
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const displayName = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;

        loginError.textContent = '';
        registerBtn.disabled = true;
        registerBtn.textContent = 'Creando...';

        let result;
        if (firebaseEnabled) {
            result = await registerWithFirebase(displayName, email, password);
        } else {
            result = await loginDemo(displayName || email.split('@')[0]);
        }

        if (result.success) {
            initSocketConnection();
        } else {
            loginError.textContent = result.error || 'Error al registrar.';
            registerBtn.disabled = false;
            registerBtn.textContent = 'Crear Cuenta';
        }
    });

    // Boton demo
    demoBtn.addEventListener('click', async () => {
        loginError.textContent = '';
        demoBtn.disabled = true;
        demoBtn.textContent = 'Conectando...';

        // Generar nombre aleatorio para demo
        const demoNames = ['Invitado', 'Visitante', 'Usuario', 'Anonimo'];
        const randomName = demoNames[Math.floor(Math.random() * demoNames.length)] + Math.floor(Math.random() * 1000);

        const result = await loginDemo(randomName);
        if (result.success) {
            initSocketConnection();
        } else {
            loginError.textContent = result.error;
            demoBtn.disabled = false;
            demoBtn.textContent = 'Entrar sin cuenta (demo)';
        }
    });

    // Boton logout
    logoutBtn.addEventListener('click', () => {
        if (confirm('Seguro que quieres cerrar sesion?')) {
            logout();
        }
    });

    // ============================================================
    //  EVENT LISTENERS DEL DOM - CHAT
    // ============================================================

    messageInput.addEventListener('input', () => {
        updateCharCounter();
        autoResizeTextarea();
        startTyping();
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendBtn.addEventListener('click', () => { sendMessage(); });
    messageInput.addEventListener('blur', () => { stopTyping(); });

    // ============================================================
    //  INICIALIZACION
    // ============================================================

    async function init() {
        // 1. Cargar tema
        loadTheme();

        // 2. Inicializar Firebase
        await initFirebase();

        // 3. Verificar si hay un JWT guardado (auto-login)
        const savedJwt = localStorage.getItem(STORAGE_KEY_JWT);
        const savedUsername = localStorage.getItem(STORAGE_KEY_USER);

        if (savedJwt && savedUsername) {
            currentJwt = savedJwt;
            currentUsername = savedUsername;
            // Reconectar automaticamente con el JWT guardado
            initSocketConnection();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
