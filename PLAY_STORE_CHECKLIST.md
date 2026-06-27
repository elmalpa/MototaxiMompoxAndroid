# Preparacion para Google Play

## Ya preparado

- App Expo identificada como `com.mototaximompox.app`.
- Perfil EAS configurado para generar Android App Bundle.
- URL del backend separada mediante `EXPO_PUBLIC_API_URL`.
- Registro publico limitado a clientes y conductores.
- Eliminacion de cuenta disponible dentro de la app.
- Sesion cifrada y persistente mediante SecureStore.
- Cambio de contraseña autenticado.
- Registro y envio de notificaciones mediante Expo Push.
- Limitacion basica de intentos de autenticacion.
- Plantillas web de privacidad y eliminacion de cuenta.
- Backend preparado para contenedor Docker y Render.
- Pruebas automáticas de seguridad básica del API.
- Ficha en español y borrador de Seguridad de los datos.
- Gráfico destacado de Play Store en 1024 × 500.

## Bloqueadores antes de publicar

- [ ] Desplegar API y SQL Server en produccion con dominio y HTTPS.
- [ ] Configurar `EXPO_PUBLIC_API_URL=https://...` en EAS.
- [ ] Generar un `JWT_SECRET` aleatorio y seguro en el servidor.
- [ ] Crear el proyecto EAS y colocar su `projectId`.
- [ ] Configurar Firebase y probar notificaciones reales.
- [ ] Completar y publicar las paginas de `legal/`.
- [ ] Definir correo de soporte y responsable de datos.
- [ ] Contratar un proveedor de SMS o correo para recuperacion de contraseña.
- [ ] Probar cliente y conductor en telefonos reales.
- [ ] Crear capturas, descripcion y grafico destacado.
- [ ] Completar Seguridad de los datos y clasificacion de contenido.
- [ ] Completar la prueba cerrada que solicite Play Console.

## Build de produccion

```powershell
cd expo-app
npx eas-cli login
npx eas-cli init
npx eas-cli secret:create --scope project --name EXPO_PUBLIC_API_URL --value https://api.tudominio.com
npm run build:production
```

No generes producción con una URL HTTP o privada.
