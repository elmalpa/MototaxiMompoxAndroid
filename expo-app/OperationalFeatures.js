import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import { apiRequest } from './api';

const button = { backgroundColor: '#146C5F', padding: 12, borderRadius: 8, marginVertical: 6 };
const input = { borderColor: '#AAB7C4', borderWidth: 1, borderRadius: 8, padding: 12, marginVertical: 6, color: '#17202A' };
export function Action({ label, onPress, disabled }) {
  return <TouchableOpacity accessibilityRole="button" disabled={disabled} style={[button, disabled && { opacity: 0.5 }]} onPress={onPress}><Text style={{ color: 'white' }}>{label}</Text></TouchableOpacity>;
}
function Panel({ visible, title, onClose, children }) {
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 48 }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>{title}</Text>{children}<Action label="Cerrar" onPress={onClose} />
    </ScrollView>
  </Modal>;
}

export function RecoveryPanel({ apiBaseUrl, token, onVerified }) {
  const [visible, setVisible] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [challengeId, setChallengeId] = useState(null);
  const [busy, setBusy] = useState(false);
  const verifying = Boolean(token);
  async function request() {
    setBusy(true);
    try {
      const data = await apiRequest(apiBaseUrl, verifying ? '/api/recovery/request-verification' : '/api/recovery/request-reset', { method: 'POST', token, body: { phone } });
      setChallengeId(data.challengeId);
      Alert.alert('Codigo solicitado', 'Si corresponde a una cuenta, recibiras un SMS. El codigo vence en 10 minutos.');
    } catch (error) { Alert.alert('Codigo', error.message); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!verifying && password !== confirmation) return Alert.alert('Clave', 'La confirmacion no coincide.');
    setBusy(true);
    try {
      await apiRequest(apiBaseUrl, verifying ? '/api/recovery/verify' : '/api/recovery/reset', { method: 'POST', token, body: { challengeId, code, new_password: password } });
      setVisible(false); setChallengeId(null); setCode(''); setPassword(''); setConfirmation('');
      onVerified?.();
      Alert.alert('Listo', verifying ? 'Telefono verificado.' : 'Clave actualizada. Inicia sesion con tu nueva clave.');
    } catch (error) { Alert.alert('Codigo', error.message); }
    finally { setBusy(false); }
  }
  return <>
    <Action label={verifying ? 'Verificar mi telefono' : 'Olvide mi contrasena'} onPress={() => setVisible(true)} />
    <Panel visible={visible} title={verifying ? 'Verificar telefono' : 'Recuperar cuenta'} onClose={() => setVisible(false)}>
      {!verifying && <TextInput accessibilityLabel="Telefono registrado" placeholder="Telefono registrado" keyboardType="phone-pad" style={input} value={phone} onChangeText={setPhone} />}
      <Action label={challengeId ? 'Solicitar otro codigo' : 'Enviar codigo por SMS'} disabled={busy} onPress={request} />
      {challengeId && <>
        <TextInput accessibilityLabel="Codigo SMS" placeholder="Codigo de 6 digitos" keyboardType="number-pad" maxLength={6} style={input} value={code} onChangeText={setCode} />
        {!verifying && <>
          <TextInput accessibilityLabel="Nueva contrasena" placeholder="Nueva contrasena" secureTextEntry style={input} value={password} onChangeText={setPassword} />
          <TextInput accessibilityLabel="Confirmar contrasena" placeholder="Confirmar contrasena" secureTextEntry style={input} value={confirmation} onChangeText={setConfirmation} />
        </>}
        <Action label="Confirmar codigo" disabled={busy} onPress={submit} />
      </>}
    </Panel>
  </>;
}

export function SupportPanel({ apiBaseUrl, token }) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [rideId, setRideId] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const result = await apiRequest(apiBaseUrl, '/api/operations/reports', { method: 'POST', token, body: { message, ride_id: rideId || null } });
      setMessage(''); setRideId(''); setVisible(false);
      Alert.alert('Reporte recibido', `Numero de seguimiento: ${result.id}`);
    } catch (error) { Alert.alert('Soporte', error.message); }
    finally { setBusy(false); }
  }
  return <>
    <Action label="Ayuda y reportes" onPress={() => setVisible(true)} />
    <Panel visible={visible} title="Ayuda y reportes" onClose={() => setVisible(false)}>
      <Text>Responsable: Carlos Ribon. Correo: chamoribon@gmail.com</Text>
      <Action label="Escribir a soporte" onPress={() => Linking.openURL('mailto:chamoribon@gmail.com').catch(() => Alert.alert('Soporte', 'Escribe a chamoribon@gmail.com desde tu correo.'))} />
      <Action label="Politica de privacidad" onPress={() => Linking.openURL(`${apiBaseUrl}/legal/privacy-policy.html`).catch(() => Alert.alert('Privacidad', 'No se pudo abrir el enlace.'))} />
      <Action label="Eliminacion de cuenta" onPress={() => Linking.openURL(`${apiBaseUrl}/legal/account-deletion.html`).catch(() => Alert.alert('Cuenta', 'No se pudo abrir el enlace.'))} />
      <TextInput accessibilityLabel="Numero de viaje opcional" placeholder="Numero de viaje (opcional)" keyboardType="number-pad" style={input} value={rideId} onChangeText={setRideId} />
      <TextInput accessibilityLabel="Describe el problema" placeholder="Describe el problema" multiline maxLength={2000} style={[input, { minHeight: 100 }]} value={message} onChangeText={setMessage} />
      <Action label="Enviar reporte" disabled={busy} onPress={submit} />
    </Panel>
  </>;
}

const mompox = { latitude: 9.24, longitude: -74.426, latitudeDelta: 0.035, longitudeDelta: 0.035 };
export function LocationPicker({ onSelect, label }) {
  const [visible, setVisible] = useState(false);
  const [point, setPoint] = useState(null);
  const [busy, setBusy] = useState(false);
  async function locate() {
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Puedes seleccionar el punto tocando el mapa.');
      const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPoint({ latitude: result.coords.latitude, longitude: result.coords.longitude });
    } catch (error) { Alert.alert('Ubicacion', error.message); }
    finally { setBusy(false); }
  }
  return <>
    <Action label={label} onPress={() => setVisible(true)} />
    <Panel visible={visible} title="Selecciona el punto" onClose={() => setVisible(false)}>
      <Text>Toca el mapa y confirma el punto. Escribe tambien una direccion o referencia.</Text>
      <MapView style={{ height: 350 }} region={{ ...mompox, ...(point || {}) }} onPress={event => setPoint(event.nativeEvent.coordinate)}>
        {point && <Marker coordinate={point} />}
      </MapView>
      <Action label="Usar mi ubicacion" disabled={busy} onPress={locate} />
      <Action label="Confirmar punto" disabled={!point} onPress={() => { onSelect(point); setVisible(false); }} />
    </Panel>
  </>;
}

export function DriverTracking({ apiBaseUrl, token, rideId }) {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!enabled || !rideId) return;
    let cancelled = false;
    let timer;
    async function send() {
      if (AppState.currentState === 'active') {
        try {
          const permission = await Location.getForegroundPermissionsAsync();
          if (permission.status !== 'granted') throw new Error('Permiso de ubicacion no disponible.');
          const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (cancelled) return;
          await apiRequest(apiBaseUrl, '/api/operations/location', { method: 'PUT', token, body: { latitude: location.coords.latitude, longitude: location.coords.longitude } });
          if (!cancelled) setMessage('Ubicacion compartida mientras mantienes la app abierta.');
        } catch (error) { if (!cancelled) setMessage(error.message); }
      }
      if (!cancelled) timer = setTimeout(send, 10000);
    }
    send();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled, rideId, apiBaseUrl, token]);
  if (!rideId) return null;
  return <View><Text>{message || 'Comparte tu ubicacion con el cliente durante esta carrera.'}</Text>
    <Action label={enabled ? 'Dejar de compartir ubicacion' : 'Compartir ubicacion de esta carrera'} onPress={async () => {
      if (enabled) { setEnabled(false); setMessage('Ubicacion pausada. El ultimo punto vence en un minuto.'); return; }
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') return Alert.alert('Ubicacion', 'Activa el permiso de ubicacion para compartirla.');
        setEnabled(true);
      } catch (error) { Alert.alert('Ubicacion', error.message); }
    }} />
  </View>;
}

export function RideMap({ apiBaseUrl, token, ride }) {
  const [location, setLocation] = useState(null);
  useEffect(() => {
    if (!['aceptado', 'en_camino'].includes(ride.status)) { setLocation(null); return; }
    let cancelled = false;
    let timer;
    async function load() {
      if (AppState.currentState === 'active') {
        try {
          const point = await apiRequest(apiBaseUrl, `/api/operations/rides/${ride.id}/location`, { token });
          if (!cancelled) setLocation(point);
        } catch { if (!cancelled) setLocation(null); }
      }
      if (!cancelled) timer = setTimeout(load, 10000);
    }
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ride.id, ride.status, apiBaseUrl, token]);
  if (!location) return <Text>El conductor aun no comparte una ubicacion reciente.</Text>;
  const point = { latitude: Number(location.latitude), longitude: Number(location.longitude) };
  return <View><Text>Ultima ubicacion compartida del conductor</Text><MapView style={{ height: 220 }} region={{ ...mompox, ...point }}><Marker coordinate={point} title="Conductor" /></MapView></View>;
}
