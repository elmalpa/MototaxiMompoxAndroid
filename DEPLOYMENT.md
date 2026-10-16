# Despliegue de Mototaxi Mompox

## Backend

El repositorio incluye `render.yaml` y `backend/Dockerfile`. En Render:

1. Crea un Blueprint desde este repositorio.
2. Configura `DB_USER`, `DB_PASSWORD`, `DB_SERVER`, `DB_DATABASE` y `CORS_ORIGINS`.
3. Usa una instancia SQL Server accesible desde Internet y restringida al servidor.
4. Ejecuta `backend/database/schema.sql` una vez sobre la base de produccion.
5. Desde `backend/`, ejecuta `npm run migrate` antes de servir el codigo nuevo.
6. Comprueba `/api/health` y `/api/ready`.

Render asignara una URL HTTPS similar a:

```text
https://mototaxi-mompox-api.onrender.com
```

## Aplicacion Android

```powershell
cd expo-app
npx eas-cli login
npx eas-cli init
```

Guarda el `projectId` generado como `EAS_PROJECT_ID` y configura la URL real:

```powershell
npx eas-cli secret:create --scope project --name EXPO_PUBLIC_API_URL --value https://TU-API
npm run build:production
```

El perfil de produccion rechaza URLs que no usen HTTPS.

## Pendientes externos

- Cuenta de Render u otro proveedor.
- SQL Server productivo.
- Cuenta Expo/EAS.
- Dominio opcional personalizado.
- Datos finales de privacidad y soporte.
- Proveedor de SMS o correo para recuperar contraseñas olvidadas.

Consulta RELEASE_STATUS.md antes del despliegue: SMS_WEBHOOK_URL/SECRET, GOOGLE_MAPS_API_KEY, GOOGLE_SERVICES_JSON y FCM v1 son necesarios para habilitar todos los servicios. Las paginas legales quedan en `/legal/` cuando se despliega este backend.

El contenedor actualizado aplica `production-hardening.sql` antes de arrancar. El esquema inicial debe existir y el usuario SQL debe poder migrarlo; si falla, el contenedor no sirve una API incompatible. SMSGate usa las seis variables SMS_PROVIDER/SMSGATE_*, ya copiadas al servicio por el configurador privado.
