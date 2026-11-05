# ChatWS - Web Chat en Tiempo Real con WebSockets, Firebase y JWT

Aplicacion de mensajeria instantanea que utiliza **Socket.IO** para comunicacion bidireccional en tiempo real, con autenticacion mediante **Firebase Auth**, tokens **JWT**, persistencia en **Firestore**, y validacion de dominios autorizados mediante **CORS**.

---

## Tabla de Contenidos

1. [Descripcion del Proyecto](#descripcion-del-proyecto)
2. [Arquitectura](#arquitectura)
3. [Estructura de Carpetas](#estructura-de-carpetas)
4. [Tecnologias Utilizadas](#tecnologias-utilizadas)
5. [Seguridad: Firebase Auth + JWT + CORS](#seguridad-firebase-auth--jwt--cors)
6. [Variables de Entorno (.env)](#variables-de-entorno-env)
7. [Como funciona WebSockets](#como-funciona-websockets)
8. [Instalacion y Configuracion](#instalacion-y-configuracion)
9. [Modo Demo (sin Firebase configurado)](#modo-demo-sin-firebase-configurado)
10. [Como configurar Firebase](#como-configurar-firebase)
11. [Pruebas con Multiples Usuarios](#pruebas-con-multiples-usuarios)
12. [Eventos de Socket.IO](#eventos-de-socketio)
13. [Endpoints de la API REST](#endpoints-de-la-api-rest)

---

## Descripcion del Proyecto

ChatWS es una aplicacion web de chat en tiempo real con las siguientes capacidades:

- Autenticacion de usuarios con Firebase (email/password) o modo demo.
- Tokens JWT para autenticar conexiones Socket.IO.
- Persistencia de mensajes en Firestore (base de datos de Firebase).
- Validacion de dominios autorizados (CORS) para conexiones de clientes.
- Variables de entorno cargadas desde archivo `.env`.
- Mensajeria en tiempo real con Socket.IO.
- Modo claro/oscuro con persistencia en LocalStorage.
- Indicador de escritura, contador de usuarios, notificaciones del sistema.
- Diseno responsive (desktop, tablet, movil).

---

## Arquitectura

```
  Navegador (Cliente)                    Servidor (Node.js)
  +-------------------+                  +------------------------+
  |  Firebase Auth    | -- Firebase ID   |  POST /api/auth/verify |
  |  (email/password) |    Token ------> |  firebase-admin        |
  |                   |                  |  verifyIdToken()       |
  |  JWT recibido     | <---- JWT ------ |  jwt.sign()            |
  |                   |                  |                        |
  |  Socket.IO        | -- auth: JWT --> |  io.use() middleware   |
  |  conexion         |                  |  jwt.verify()          |
  |                   |                  |                        |
  |  chat-message     | -- mensaje ----> |  validate + escape     |
  |                   |                  |  save to Firestore     |
  |  chat-message     | <-- broadcast -- |  io.emit()             |
  +-------------------+                  |                        |
                                         |  Firestore DB          |
                                         |  (coleccion: messages) |
                                         +------------------------+
```

### Responsabilidad del Cliente vs Servidor

| Aspecto | Cliente | Servidor |
|---|---|---|
| **Autenticacion** | Firebase Auth (email/password) | Verifica Firebase token + firma JWT |
| **Conexion Socket.IO** | Envia JWT en `auth.token` | Middleware verifica JWT |
| **Validacion de mensajes** | Primera capa (UI) | Capa final obligatoria |
| **Identidad de usuarios** | No decide identidad | Obtiene del JWT verificado |
| **Persistencia** | No guarda mensajes | Guarda en Firestore |
| **CORS** | - | Solo dominios en `.env` |
| **Escapado HTML** | Usa `textContent` | Escapa con `escapeHtml()` |

---

## Estructura de Carpetas

```
LabWebAv-WebSocketChat/
├── server/
│   └── server.js          # Servidor: Express + Socket.IO + Firebase + JWT
├── public/
│   ├── index.html         # HTML con Firebase Auth SDK + Socket.IO
│   ├── css/
│   │   └── styles.css     # Estilos completos con temas y responsive
│   ├── js/
│   │   └── chat.js        # Logica: Firebase Auth, JWT, Socket.IO, UI
│   └── assets/
│       └── icons/
├── .env                   # Variables de entorno (NO subir a git)
├── .gitignore             # Excluye .env y node_modules
├── package.json           # Dependencias y scripts
└── README.md
```

---

## Tecnologias Utilizadas

| Tecnologia | Uso en el proyecto |
|---|---|
| **HTML5** | Estructura semantica de la interfaz |
| **CSS3** | Diseno visual, animaciones, variables CSS, responsive |
| **JavaScript Vanilla** | Logica del cliente (sin frameworks frontend) |
| **Node.js** | Entorno de ejecucion del servidor |
| **Express.js** | Servidor HTTP, API REST, archivos estaticos |
| **Socket.IO** | Comunicacion bidireccional en tiempo real |
| **Firebase Auth** | Autenticacion de usuarios (email/password) |
| **Firebase Admin SDK** | Verificacion de tokens en el servidor |
| **Firestore** | Base de datos para persistir mensajes |
| **JWT (jsonwebtoken)** | Tokens de autenticacion firmados |
| **dotenv** | Carga de variables de entorno desde `.env` |
| **cors** | Validacion de dominios autorizados |
| **LocalStorage** | Persistencia del tema, JWT y nombre de usuario |

---

## Seguridad: Firebase Auth + JWT + CORS

### Flujo de autenticacion completo

1. **El usuario se autentica con Firebase** en la pantalla de login (email/password).
2. **Firebase Auth** devuelve un **Firebase ID Token** al cliente.
3. **El cliente envia el Firebase ID Token** al endpoint `POST /api/auth/verify`.
4. **El servidor verifica el Firebase ID Token** usando `firebase-admin` (`verifyIdToken()`).
5. **El servidor firma un JWT propio** (con `JWT_SECRET` de `.env`) que contiene `uid`, `username` y `email`.
6. **El cliente recibe el JWT** y lo guarda en LocalStorage.
7. **El cliente se conecta a Socket.IO** pasando el JWT en `socket.handshake.auth.token`.
8. **El middleware de Socket.IO** (`io.use()`) verifica el JWT en cada conexion. Si es invalido, la conexion se rechaza.
9. **Al enviar mensajes**, el servidor obtiene la identidad del usuario desde el JWT (no confia en el cliente).

### Por que JWT ademas de Firebase?

- Firebase ID Tokens expiran en 1 hora. El JWT del servidor puede tener una expiracion mas larga (24h por defecto).
- El JWT del servidor no requiere una llamada de red a Firebase para verificarlo (es local con `JWT_SECRET`).
- Permite un modo demo sin Firebase configurado, manteniendo la misma arquitectura de seguridad.

### CORS: Validacion de dominios

El servidor solo acepta conexiones de clientes desde los dominios especificados en `ALLOWED_ORIGINS` dentro del archivo `.env`. Esto aplica tanto a:

- **Express** (peticiones HTTP/REST)
- **Socket.IO** (conexiones WebSocket)

Cualquier origen no autorizado es rechazado automaticamente.

---

## Variables de Entorno (.env)

El archivo `.env` contiene toda la configuracion del servidor. Nunca debe subirse a un repositorio publico (esta en `.gitignore`).

| Variable | Descripcion |
|---|---|
| `PORT` | Puerto del servidor (default: 3000) |
| `JWT_SECRET` | Clave secreta para firmar JWT |
| `JWT_EXPIRES_IN` | Tiempo de expiracion del JWT (default: 24h) |
| `ALLOWED_ORIGINS` | Dominios permitidos para CORS (separados por coma) |
| `FIREBASE_PROJECT_ID` | ID del proyecto de Firebase |
| `FIREBASE_CLIENT_EMAIL` | Email de la cuenta de servicio de Firebase |
| `FIREBASE_PRIVATE_KEY` | Clave privada de la cuenta de servicio |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Alternativa: ruta al JSON de la cuenta de servicio |
| `FIREBASE_API_KEY` | API key de Firebase (cliente, publica) |
| `FIREBASE_AUTH_DOMAIN` | Dominio de autenticacion |
| `FIREBASE_PROJECT_ID_CLIENT` | ID del proyecto (cliente) |
| `FIREBASE_STORAGE_BUCKET` | Bucket de storage |
| `FIREBASE_MESSAGING_SENDER_ID` | Sender ID |
| `FIREBASE_APP_ID` | App ID |
| `FIRESTORE_MESSAGES_COLLECTION` | Nombre de la coleccion de mensajes (default: messages) |

---

## Como funciona WebSockets

### El problema de HTTP tradicional

HTTP sigue un modelo peticion-respuesta: el cliente pregunta, el servidor responde, y la conexion se cierra. Esto no sirve para tiempo real porque requiere polling constante.

### WebSockets con Socket.IO

WebSocket proporciona comunicacion **full-duplex** (bidireccional) sobre una sola conexion TCP persistente:

- El cliente y el servidor pueden enviarse mensajes en cualquier momento.
- La conexion permanece abierta hasta que una parte la cierra.
- Socket.IO anade reconexion automatica, eventos personalizados y fallback.

### Flujo de un mensaje

1. El usuario escribe y presiona Enter.
2. El cliente valida el mensaje (longitud, no vacio).
3. El cliente emite `chat-message` al servidor.
4. El servidor valida de nuevo, escapa HTML y guarda en Firestore.
5. El servidor distribuye el mensaje a todos los clientes via `io.emit()`.
6. Cada cliente recibe el evento y renderiza la burbuja.

---

## Instalacion y Configuracion

### Requisitos previos

- **Node.js** v18 o superior.

### Pasos

1. **Instalar dependencias:**

```bash
npm install
```

2. **Configurar variables de entorno:**

Editar el archivo `.env` con tus credenciales reales de Firebase (ver [Como configurar Firebase](#como-configurar-firebase)).

3. **Iniciar el servidor:**

```bash
npm start
```

4. **Abrir el chat:**

```
http://localhost:3000
```

---

## Modo Demo (sin Firebase configurado)

Si no se configuran las credenciales de Firebase en `.env`, el servidor funciona en **modo demo**:

- La autenticacion Firebase se desactiva.
- El endpoint `/api/auth/verify` acepta un nombre de usuario directo (sin verificar).
- El servidor firma un JWT en modo demo (`firebase: false`).
- Firestore no esta disponible (los mensajes no se persisten).
- El boton "Entrar sin cuenta (demo)" permite acceso rapido.
- El resto de funcionalidades (chat en tiempo real, typing, temas, etc.) funcionan normalmente.

El servidor muestra al iniciar:

```
Seguridad:
  Firebase Auth: NO configurado (modo demo)
  JWT:           ACTIVO
  CORS:          3 origen(es) permitido(s)
  Firestore:     NO configurado
```

---

## Como configurar Firebase

### Paso 1: Crear proyecto en Firebase

1. Ir a [https://console.firebase.google.com](https://console.firebase.google.com)
2. Crear un nuevo proyecto.
3. Habilitar **Authentication** > Sign-in method > **Email/Password**.
4. Habilitar **Firestore Database** (modo de prueba o produccion).

### Paso 2: Obtener claves del cliente (Web SDK)

1. En Firebase Console: Configuracion del proyecto > Tus apps.
2. Agregar una app web (icono `</>`).
3. Copiar los valores de `firebaseConfig`.

Pegar estos valores en `.env`:

```
FIREBASE_API_KEY=AIzaSy...
FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
FIREBASE_PROJECT_ID_CLIENT=tu-proyecto-12345
FIREBASE_STORAGE_BUCKET=tu-proyecto.appspot.com
FIREBASE_MESSAGING_SENDER_ID=1234567890
FIREBASE_APP_ID=1:1234567890:web:abcdef
```

### Paso 3: Obtener cuenta de servicio (Admin SDK)

1. En Firebase Console: Configuracion del proyecto > Cuentas de servicio.
2. Click en "Generar nueva clave privada" -> descarga un archivo JSON.
3. Copiar los valores del JSON en `.env`:

```
FIREBASE_PROJECT_ID=tu-proyecto-12345
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@tu-proyecto.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

O alternativamente, guardar el JSON en el proyecto y usar:

```
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
```

### Paso 4: Reiniciar el servidor

```bash
npm start
```

Ahora el servidor mostrara:

```
Seguridad:
  Firebase Auth: ACTIVO
  JWT:           ACTIVO
  CORS:          N origen(es) permitido(s)
  Firestore:     ACTIVO
```

---

## Pruebas con Multiples Usuarios

### Opcion A: Multiples pestañas

1. Abre `http://localhost:3000` en una pestana, registrate o usa demo.
2. Abre otra pestana, entra con otra cuenta.
3. Intercambia mensajes en tiempo real.

### Opcion B: Dos navegadores diferentes

1. Chrome: entra con una cuenta.
2. Firefox/Edge: entra con otra cuenta.

### Opcion C: Dispositivos en la misma red WiFi

1. Averigua la IP local del servidor (mostrada al iniciar `npm start`).
2. Abre el firewall para el puerto 3000.
3. Desde otro dispositivo: `http://<IP>:3000`

---

## Eventos de Socket.IO

| Evento | Direccion | Descripcion |
|---|---|---|
| `connection` | Servidor | Cliente se conecta (JWT verificado en middleware) |
| `disconnect` | Servidor | Cliente se desconecta |
| `user-joined` | Cliente -> Servidor | Cliente confirma entrada |
| `join-success` | Servidor -> Cliente | Servidor confirma registro |
| `join-error` | Servidor -> Cliente | Error de registro |
| `chat-message` | Bidireccional | Envio y distribucion de mensajes |
| `message-error` | Servidor -> Cliente | Mensaje rechazado por validacion |
| `user-joined` | Servidor -> Clientes | Notificacion de entrada (broadcast) |
| `user-left` | Servidor -> Clientes | Notificacion de salida (broadcast) |
| `users-count` | Servidor -> Todos | Contador de usuarios conectados |
| `users-list` | Servidor -> Todos | Lista de usuarios conectados |
| `typing` | Bidireccional | Usuario escribiendo |
| `stop-typing` | Bidireccional | Usuario dejo de escribir |

---

## Endpoints de la API REST

| Metodo | Ruta | Descripcion | Auth |
|---|---|---|---|
| `GET` | `/` | Sirve index.html | No |
| `GET` | `/api/config` | Config publica de Firebase | No |
| `POST` | `/api/auth/verify` | Intercambia Firebase token por JWT | No |
| `GET` | `/api/messages` | Ultimos 50 mensajes (Firestore) | JWT requerido |

### Ejemplo: Obtener JWT

```bash
curl -X POST http://localhost:3000/api/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"firebaseToken": "<FIREBASE_ID_TOKEN>"}'
```

Respuesta:

```json
{
  "jwt": "eyJhbGci...",
  "username": "Carlos",
  "uid": "abc123"
}
```

### Ejemplo: Obtener mensajes

```bash
curl http://localhost:3000/api/messages \
  -H "Authorization: Bearer <JWT>"
```
#   L a b W e b A v - W e b S o c k e t C h a t  
 #   L a b W e b A v - W e b S o c k e t C h a t  
 