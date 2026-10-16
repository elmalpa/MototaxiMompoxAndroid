# Mototaxi Mompox

Proyecto base para solicitudes de mototaxi en Mompox. Incluye una API Node/Express y una app Android nativa minima que valida conexion con el backend.

La aplicacion principal para continuar y publicar es `expo-app/`. La carpeta
`app/` contiene solamente un prototipo Android nativo de conectividad.

## Backend

Requisitos:

- Node.js 24 LTS
- SQL Server disponible
- Base de datos `MototaxiMompox`

Preparacion:

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

Edita `backend/.env` con tus credenciales reales. No subas ese archivo a repositorios.

Crear tablas iniciales:

```powershell
sqlcmd -S 127.0.0.1,1433 -U sa -P "<password>" -i database/schema.sql
```

Aplicar la migracion de seguridad despues de crear el esquema:

```powershell
cd backend
npm run migrate
```

Arrancar API:

```powershell
npm start
```

Validar sintaxis:

```powershell
npm run check
```

Health check:

```text
GET http://localhost:4000/api/health
```

## Notificaciones

La aplicacion usa Expo Push Notifications. El dispositivo registra su token al
iniciar sesion y el backend envia las actualizaciones mediante el servicio de Expo.

## Android

Requisitos:

- JDK 17 o superior
- Android SDK con plataforma 34

En esta maquina el `java` del PATH apunta a Java 8. Para compilar desde PowerShell usa JDK 17 explicitamente:

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot'
.\gradlew.bat assembleDebug
```

APK debug:

```text
app/build/outputs/apk/debug/app-debug.apk
```

La app nativa usa una direccion local y se conserva solamente como prototipo.

La app principal Expo ya incluye pantallas cliente/conductor/administrador. No distribuir el APK nativo de esta carpeta como si fuera la app completa.

## Expo Go

Tambien hay una version Expo en `expo-app/` para verla con Expo Go.

Arranca primero el backend:

```powershell
cd backend
npm start
```

En otra terminal crea la configuracion local e inicia Expo:

```powershell
cd expo-app
Copy-Item .env.example .env
# Edita EXPO_PUBLIC_API_URL con la IP actual del backend.
npm start
```

Escanea el QR con Expo Go. Para produccion, `EXPO_PUBLIC_API_URL` debe ser una
URL HTTPS publica configurada en EAS. Consulta `PLAY_STORE_CHECKLIST.md`.

## Estado actual

Consulta [RELEASE_STATUS.md](RELEASE_STATUS.md) para funciones implementadas, validacion, migracion y dependencias externas. El telefono debe verificarse por SMS para solicitar/aceptar carreras; sin configurar el gateway SMS, esas acciones permanecen bloqueadas. Soporte: Carlos Ribon, chamoribon@gmail.com.
