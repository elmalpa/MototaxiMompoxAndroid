import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  NativeModules,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const CONFIGURED_API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
const SESSION_KEY = 'mototaxi_mompox_session';
const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';
const Notifications = IS_EXPO_GO ? null : require('expo-notifications');

if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function getPushToken() {
  if (!Notifications || !Device.isDevice) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('viajes', {
      name: 'Actualizaciones de viajes',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  if (!projectId) return null;

  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

function getDefaultApiBaseUrl() {
  if (CONFIGURED_API_BASE_URL) {
    return CONFIGURED_API_BASE_URL;
  }

  if (!__DEV__) {
    return '';
  }

  const scriptUrl = NativeModules.SourceCode?.scriptURL;
  const hostMatch = scriptUrl?.match(/^https?:\/\/([^:/]+)(?::\d+)?\//);
  const host = hostMatch?.[1];

  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:4000`;
  }

  return 'http://10.0.2.2:4000';
}

async function apiRequest(apiBaseUrl, path, { method = 'GET', token, body } = {}) {
  if (!apiBaseUrl) {
    throw new Error('La URL de produccion no esta configurada. Define EXPO_PUBLIC_API_URL con una direccion HTTPS.');
  }

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    throw new Error(`No se pudo leer respuesta del backend: ${error.message}`);
  }

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = {
        raw: text,
        parseError: error.message,
      };
    }
  }

  if (!response.ok) {
    const fallback = data?.raw ? `${data.raw}` : `Error ${response.status}`;
    throw new Error(data?.error || fallback);
  }

  if (data?.parseError) {
    throw new Error(`Respuesta invalida del backend: ${data.raw || data.parseError}`);
  }

  return data;
}

async function apiCommand(apiBaseUrl, path, { method = 'PATCH', token, body } = {}) {
  if (!apiBaseUrl) {
    throw new Error('La URL de produccion no esta configurada. Define EXPO_PUBLIC_API_URL con una direccion HTTPS.');
  }

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.ok) {
    return true;
  }

  let message = `Error ${response.status}`;
  try {
    const text = await response.text();
    if (text) {
      try {
        const data = JSON.parse(text);
        message = data?.error || text;
      } catch {
        message = text;
      }
    }
  } catch {
    message = `Error ${response.status}`;
  }

  throw new Error(message);
}

export default function App() {
  const [apiBaseUrl] = useState(getDefaultApiBaseUrl);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [apiOk, setApiOk] = useState(null);
  const [apiMessage, setApiMessage] = useState('Probando conexion...');
  const [authMode, setAuthMode] = useState('login');
  const [role, setRole] = useState('cliente');
  const [authForm, setAuthForm] = useState({
    name: '',
    phone: '',
    password: '',
    vehicle_plate: '',
  });
  const [busy, setBusy] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirmation: '' });

  useEffect(() => {
    checkApi();
    restoreSession();
  }, []);

  async function restoreSession() {
    try {
      const stored = await SecureStore.getItemAsync(SESSION_KEY);
      if (!stored) return;

      const session = JSON.parse(stored);
      const data = await apiRequest(apiBaseUrl, '/api/auth/me', { token: session.token });
      setToken(session.token);
      setUser(data.user);
      registerPushToken(session.token);
    } catch {
      await SecureStore.deleteItemAsync(SESSION_KEY);
    } finally {
      setRestoringSession(false);
    }
  }

  async function registerPushToken(activeToken) {
    try {
      const pushToken = await getPushToken();
      if (!pushToken) return;
      await apiCommand(apiBaseUrl, '/api/auth/push-token', {
        method: 'PATCH',
        token: activeToken,
        body: { fcm_token: pushToken },
      });
    } catch {
      // Las notificaciones no deben bloquear el acceso a la aplicacion.
    }
  }

  async function checkApi() {
    try {
      const data = await apiRequest(apiBaseUrl, '/api/health');
      setApiOk(true);
      setApiMessage(`${data.app} listo`);
    } catch (error) {
      setApiOk(false);
      setApiMessage('No conecta con el backend');
    }
  }

  function updateAuthField(key, value) {
    setAuthForm(current => ({ ...current, [key]: value }));
  }

  async function submitAuth() {
    setBusy(true);
    try {
      const payload = {
        phone: authForm.phone.trim(),
        password: authForm.password,
      };

      if (authMode === 'register') {
        payload.name = authForm.name.trim();
        payload.role = role;
        if (role === 'conductor') payload.vehicle_plate = authForm.vehicle_plate.trim().toUpperCase();
      }

      const data = await apiRequest(apiBaseUrl, authMode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        body: payload,
      });

      setUser(data.user);
      setToken(data.token);
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({
        token: data.token,
        user: data.user,
      }));
      registerPushToken(data.token);
      setAuthForm(current => ({ ...current, password: '' }));
    } catch (error) {
      Alert.alert('No se pudo entrar', error.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setUser(null);
    setToken(null);
  }

  async function changePassword() {
    if (passwordForm.next.length < 8) {
      Alert.alert('Nueva clave', 'Debe tener al menos 8 caracteres.');
      return;
    }
    if (passwordForm.next !== passwordForm.confirmation) {
      Alert.alert('Nueva clave', 'La confirmacion no coincide.');
      return;
    }

    setBusy(true);
    try {
      await apiCommand(apiBaseUrl, '/api/auth/password', {
        method: 'PATCH',
        token,
        body: {
          current_password: passwordForm.current,
          new_password: passwordForm.next,
        },
      });
      setPasswordModalVisible(false);
      setPasswordForm({ current: '', next: '', confirmation: '' });
      Alert.alert('Clave actualizada', 'Tu contraseña fue cambiada correctamente.');
    } catch (error) {
      Alert.alert('No se pudo cambiar', error.message);
    } finally {
      setBusy(false);
    }
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Eliminar cuenta',
      'Esta accion elimina tu cuenta y tus datos de viajes. No se puede deshacer.',
      [
        { text: 'Conservar cuenta', style: 'cancel' },
        {
          text: 'Eliminar definitivamente',
          style: 'destructive',
          onPress: deleteAccount,
        },
      ],
    );
  }

  async function deleteAccount() {
    try {
      await apiCommand(apiBaseUrl, '/api/auth/account', {
        method: 'DELETE',
        token,
      });
      await logout();
      Alert.alert('Cuenta eliminada', 'Tu cuenta fue eliminada correctamente.');
    } catch (error) {
      Alert.alert('No se pudo eliminar la cuenta', error.message);
    }
  }

  const header = (
    <AppHeader
      apiOk={apiOk}
      apiMessage={apiMessage}
      user={user}
      onLogout={logout}
      onDeleteAccount={confirmDeleteAccount}
      onChangePassword={() => setPasswordModalVisible(true)}
      onCheckApi={checkApi}
    />
  );

  if (restoringSession) {
    return (
      <Shell>
        <View style={styles.loadingScreen}>
          <ActivityIndicator color="#146C5F" size="large" />
          <Text style={styles.subtitle}>Restaurando sesion...</Text>
        </View>
      </Shell>
    );
  }

  const passwordModal = (
    <PasswordModal
      busy={busy}
      form={passwordForm}
      onCancel={() => setPasswordModalVisible(false)}
      onChange={setPasswordForm}
      onSubmit={changePassword}
      visible={passwordModalVisible}
    />
  );

  if (!user || !token) {
    return (
      <Shell>
        {header}
        <AuthScreen
          apiBaseUrl={apiBaseUrl}
          authMode={authMode}
          busy={busy}
          form={authForm}
          role={role}
          setAuthMode={setAuthMode}
          setRole={setRole}
          submitAuth={submitAuth}
          updateField={updateAuthField}
        />
      </Shell>
    );
  }

  if (user.role === 'cliente') {
    return (
      <Shell>
        {header}
        {passwordModal}
        <ClientScreen apiBaseUrl={apiBaseUrl} token={token} />
      </Shell>
    );
  }

  if (user.role === 'conductor') {
    return (
      <Shell>
        {header}
        {passwordModal}
        <DriverScreen apiBaseUrl={apiBaseUrl} token={token} />
      </Shell>
    );
  }

  return (
    <Shell>
      {header}
      {passwordModal}
      <AdminScreen apiBaseUrl={apiBaseUrl} token={token} />
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoider}
      >
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AppHeader({ apiOk, apiMessage, user, onLogout, onDeleteAccount, onChangePassword, onCheckApi }) {
  return (
    <View style={styles.topBar}>
      <View style={styles.topTitleWrap}>
        <Text style={styles.brand}>Mototaxi Mompox</Text>
        <View style={styles.statusLine}>
          <View style={[styles.dot, apiOk === true && styles.dotOk, apiOk === false && styles.dotError]} />
          <Text style={styles.statusSmall}>{apiMessage}</Text>
        </View>
        {user ? <Text style={styles.userLine}>{user.name} - {user.role}</Text> : null}
      </View>
      <View style={styles.headerActions}>
        <IconButton label="API" onPress={onCheckApi} />
        {user ? <IconButton label="Clave" onPress={onChangePassword} /> : null}
        {user ? <IconButton label="Borrar" onPress={onDeleteAccount} /> : null}
        {user ? <IconButton label="Salir" onPress={onLogout} /> : null}
      </View>
    </View>
  );
}

function AuthScreen({ apiBaseUrl, authMode, busy, form, role, setAuthMode, setRole, submitAuth, updateField }) {
  return (
    <ScrollView
      contentContainerStyle={[styles.container, styles.authContainer]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{authMode === 'login' ? 'Entrar' : 'Crear cuenta'}</Text>
      <Text style={styles.subtitle}>Solicita un servicio o registrate como conductor.</Text>

      <SegmentedControl
        value={authMode}
        options={[
          { value: 'login', label: 'Login' },
          { value: 'register', label: 'Registro' },
        ]}
        onChange={setAuthMode}
      />

      {authMode === 'register' ? (
        <SegmentedControl
          value={role}
          options={[
            { value: 'cliente', label: 'Cliente' },
            { value: 'conductor', label: 'Conductor' },
          ]}
          onChange={setRole}
        />
      ) : null}

      {authMode === 'register' ? (
        <Field label="Nombre" value={form.name} onChangeText={value => updateField('name', value)} />
      ) : null}

      <Field
        keyboardType="phone-pad"
        label="Telefono"
        value={form.phone}
        onChangeText={value => updateField('phone', value)}
      />
      <Field
        label="Contrasena"
        secureTextEntry
        value={form.password}
        onChangeText={value => updateField('password', value)}
      />

      {authMode === 'register' && role === 'conductor' ? (
        <Field
          autoCapitalize="characters"
          label="Placa de la moto"
          value={form.vehicle_plate}
          onChangeText={value => updateField('vehicle_plate', value)}
        />
      ) : null}

      <PrimaryButton
        busy={busy}
        label={authMode === 'login' ? 'Entrar' : 'Crear cuenta'}
        onPress={submitAuth}
      />
      {__DEV__ ? <Text style={styles.footer}>Backend: {apiBaseUrl || 'sin configurar'}</Text> : null}
    </ScrollView>
  );
}

function ClientScreen({ apiBaseUrl, token }) {
  const [rideForm, setRideForm] = useState({
    pickup_address: '',
    destination_address: '',
    offered_price: '3000',
  });
  const [rides, setRides] = useState([]);
  const [ratingForms, setRatingForms] = useState({});
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const alertedOfferIdsRef = useRef(new Set());

  useEffect(() => {
    loadRides();
    const intervalId = setInterval(() => {
      loadRides({ silent: true });
    }, 5000);

    return () => clearInterval(intervalId);
  }, []);

  function updateRideField(key, value) {
    setRideForm(current => ({ ...current, [key]: value }));
  }

  async function loadRides({ silent = false } = {}) {
    if (!silent) setRefreshing(true);
    try {
      const nextRides = await apiRequest(apiBaseUrl, '/api/rides/my', { token });
      const newOffer = nextRides.find(ride => (
        ride.status === 'ofertado' && !alertedOfferIdsRef.current.has(ride.id)
      ));

      setRides(nextRides);

      if (newOffer) {
        alertedOfferIdsRef.current.add(newOffer.id);
        const price = Number(newOffer.driver_offer_price || newOffer.estimated_price || 0);
        const driverName = newOffer.driver_name || 'Un conductor';
        Alert.alert(
          'Nueva contraoferta',
          `${driverName} propuso $${price.toLocaleString('es-CO')}. Puedes aceptar o esperar otro conductor.`,
        );
      }
    } catch (error) {
      if (!silent) Alert.alert('Mis viajes', error.message);
    } finally {
      if (!silent) setRefreshing(false);
    }
  }

  async function createRide() {
    const offeredPrice = Number(rideForm.offered_price);
    if (!rideForm.pickup_address.trim() || !rideForm.destination_address.trim()) {
      Alert.alert('Faltan datos', 'Indica donde te recogen y para donde vas.');
      return;
    }
    if (!Number.isFinite(offeredPrice) || offeredPrice < 3000) {
      Alert.alert('Precio invalido', 'La oferta debe ser de 3000 pesos en adelante.');
      return;
    }

    setBusy(true);
    try {
      await apiRequest(apiBaseUrl, '/api/rides', {
        method: 'POST',
        token,
        body: {
          pickup_address: rideForm.pickup_address.trim(),
          destination_address: rideForm.destination_address.trim(),
          offered_price: offeredPrice,
        },
      });
      Alert.alert('Servicio creado', 'Tu solicitud fue enviada a los conductores.');
      setRideForm({
        pickup_address: '',
        destination_address: '',
        offered_price: '3000',
      });
      await loadRides({ silent: true });
    } catch (error) {
      Alert.alert('No se pudo solicitar', error.message);
    } finally {
      setBusy(false);
    }
  }

  async function acceptDriverOffer(rideId) {
    setBusyId(`client-accept-${rideId}`);
    try {
      await apiCommand(apiBaseUrl, `/api/rides/${rideId}/client-accept`, { token });
      setRides(current => current.map(ride => (
        ride.id === rideId
          ? {
              ...ride,
              status: 'aceptado',
              estimated_price: ride.driver_offer_price || ride.estimated_price,
            }
          : ride
      )));
    } catch (error) {
      Alert.alert('Aceptar oferta v2', `${error.message}\n\n${apiBaseUrl}/api/rides/${rideId}/client-accept`);
    } finally {
      setBusyId(null);
    }
  }

  async function rejectDriverOffer(rideId) {
    setBusyId(`client-reject-${rideId}`);
    try {
      await apiCommand(apiBaseUrl, `/api/rides/${rideId}/client-reject`, { token });
      await loadRides();
      Alert.alert('Buscando otro conductor', 'La contraoferta fue rechazada y el servicio queda disponible para otros conductores.');
    } catch (error) {
      Alert.alert('Esperar otro conductor', error.message);
    } finally {
      setBusyId(null);
    }
  }

  function confirmCancelRide(ride) {
    Alert.alert(
      'Cancelar servicio',
      ride.driver_name
        ? `Vas a cancelar el servicio con ${ride.driver_name}.`
        : 'Vas a cancelar este servicio.',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Cancelar servicio',
          style: 'destructive',
          onPress: () => cancelRide(ride.id),
        },
      ]
    );
  }

  async function cancelRide(rideId) {
    setBusyId(`client-cancel-${rideId}`);
    try {
      await apiRequest(apiBaseUrl, `/api/rides/${rideId}/status`, {
        method: 'PATCH',
        token,
        body: { status: 'cancelado' },
      });
      await loadRides();
      Alert.alert('Servicio cancelado', 'Tu servicio fue cancelado.');
    } catch (error) {
      Alert.alert('Cancelar servicio', error.message);
    } finally {
      setBusyId(null);
    }
  }

  function updateRatingForm(rideId, changes) {
    setRatingForms(current => ({
      ...current,
      [rideId]: {
        rating: current[rideId]?.rating || 'bueno',
        comment: current[rideId]?.comment || '',
        ...changes,
      },
    }));
  }

  async function submitDriverRating(rideId) {
    const form = ratingForms[rideId] || { rating: 'bueno', comment: '' };
    if (form.rating === 'malo' && !form.comment.trim()) {
      Alert.alert('Calificacion', 'Escribe por que el servicio fue malo.');
      return;
    }

    setBusyId(`client-rating-${rideId}`);
    try {
      await apiRequest(apiBaseUrl, `/api/rides/${rideId}/rating`, {
        method: 'PATCH',
        token,
        body: {
          rating: form.rating,
          comment: form.rating === 'malo' ? form.comment.trim() : '',
        },
      });
      await loadRides();
      Alert.alert('Gracias', 'Tu calificacion fue enviada al administrador.');
    } catch (error) {
      Alert.alert('Calificacion', error.message);
    } finally {
      setBusyId(null);
    }
  }

  function renderRideFooter(ride) {
    const canCancel = ['ofertado', 'aceptado', 'en_camino'].includes(ride.status);
    const canRate = ride.status === 'finalizado' && !ride.driver_service_rating;

    if (!canCancel && !canRate) return null;

    const ratingForm = ratingForms[ride.id] || { rating: 'bueno', comment: '' };

    return (
      <View style={styles.actionsColumn}>
        {ride.status === 'ofertado' ? (
          <>
            <PrimaryButton
              busy={busyId === `client-accept-${ride.id}`}
              label="Aceptar precio"
              onPress={() => acceptDriverOffer(ride.id)}
            />
            <SecondaryActionButton
              busy={busyId === `client-reject-${ride.id}`}
              label="Esperar otro conductor"
              onPress={() => rejectDriverOffer(ride.id)}
            />
          </>
        ) : null}
        {['aceptado', 'en_camino'].includes(ride.status) ? (
          <DangerButton
            busy={busyId === `client-cancel-${ride.id}`}
            label="Cancelar servicio"
            onPress={() => confirmCancelRide(ride)}
          />
        ) : null}
        {canRate ? (
          <View style={styles.ratingPanel}>
            <Text style={styles.ratingTitle}>Califica al conductor</Text>
            <SegmentedControl
              value={ratingForm.rating}
              options={[
                { value: 'bueno', label: 'Bueno' },
                { value: 'regular', label: 'Regular' },
                { value: 'malo', label: 'Malo' },
              ]}
              onChange={value => updateRatingForm(ride.id, { rating: value })}
            />
            {ratingForm.rating === 'malo' ? (
              <Field
                label="Por que fue malo"
                value={ratingForm.comment}
                onChangeText={value => updateRatingForm(ride.id, { comment: value })}
              />
            ) : null}
            <PrimaryButton
              busy={busyId === `client-rating-${ride.id}`}
              label="Enviar calificacion"
              onPress={() => submitDriverRating(ride.id)}
            />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadRides} />}
    >
      <Text style={styles.title}>Cliente</Text>
      <Text style={styles.subtitle}>Solicita un mototaxi y mira el estado de tus viajes.</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Nuevo servicio</Text>
        <Field label="Donde te recogen" value={rideForm.pickup_address} onChangeText={value => updateRideField('pickup_address', value)} />
        <Field label="Para donde vas" value={rideForm.destination_address} onChangeText={value => updateRideField('destination_address', value)} />
        <Field label="Tu oferta desde $3000" keyboardType="numeric" value={rideForm.offered_price} onChangeText={value => updateRideField('offered_price', value)} />
        <PrimaryButton busy={busy} label="Solicitar mototaxi" onPress={createRide} />
      </View>

      <ListSection
        empty="Aun no tienes viajes."
        items={rides}
        renderItem={ride => (
          <RideCard
            key={ride.id}
            ride={ride}
            footer={renderRideFooter(ride)}
          />
        )}
        title="Mis viajes"
      />
    </ScrollView>
  );
}

function DriverScreen({ apiBaseUrl, token }) {
  const [profile, setProfile] = useState(null);
  const [available, setAvailable] = useState([]);
  const [myRides, setMyRides] = useState([]);
  const [offerPrices, setOfferPrices] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setRefreshing(true);
    try {
      const [profileData, availableData, myData] = await Promise.all([
        apiRequest(apiBaseUrl, '/api/drivers/me', { token }),
        apiRequest(apiBaseUrl, '/api/rides/available', { token }),
        apiRequest(apiBaseUrl, '/api/rides/my', { token }),
      ]);
      setProfile(profileData);
      setAvailable(availableData);
      setMyRides(myData);
    } catch (error) {
      Alert.alert('Conductor', error.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function updateAvailability(nextValue) {
    setBusyId('availability');
    try {
      const data = await apiRequest(apiBaseUrl, '/api/drivers/availability', {
        method: 'PATCH',
        token,
        body: { is_available: nextValue },
      });
      setProfile(current => ({ ...current, is_available: data.is_available }));
    } catch (error) {
      Alert.alert('Disponibilidad', error.message);
    } finally {
      setBusyId(null);
    }
  }

  function getActiveRide() {
    return myRides.find(ride => ['ofertado', 'aceptado', 'en_camino'].includes(ride.status));
  }

  function alertActiveRide(activeRide) {
    const statusText = activeRide.status === 'en_camino' ? 'en camino' : activeRide.status;
    Alert.alert(
      'Carrera activa',
      `No puedes aceptar otra carrera hasta finalizar la que tienes ${statusText}.`
    );
  }

  async function acceptRide(rideId) {
    const activeRide = getActiveRide();
    if (activeRide) {
      alertActiveRide(activeRide);
      return;
    }

    setBusyId(`accept-${rideId}`);
    try {
      await apiRequest(apiBaseUrl, `/api/rides/${rideId}/accept`, { method: 'PATCH', token });
      await loadAll();
    } catch (error) {
      Alert.alert('Aceptar viaje', error.message);
    } finally {
      setBusyId(null);
    }
  }

  async function offerRidePrice(rideId) {
    const activeRide = getActiveRide();
    if (activeRide) {
      alertActiveRide(activeRide);
      return;
    }

    const offeredPrice = Number(offerPrices[rideId]);
    if (!Number.isFinite(offeredPrice) || offeredPrice < 3000) {
      Alert.alert('Contraoferta', 'El precio debe ser de 3000 pesos en adelante.');
      return;
    }

    setBusyId(`offer-${rideId}`);
    try {
      await apiRequest(apiBaseUrl, `/api/rides/${rideId}/offer`, {
        method: 'PATCH',
        token,
        body: { offered_price: offeredPrice },
      });
      await loadAll();
    } catch (error) {
      Alert.alert('Contraoferta', error.message);
    } finally {
      setBusyId(null);
    }
  }

  async function updateStatus(rideId, status) {
    setBusyId(`${status}-${rideId}`);
    try {
      await apiRequest(apiBaseUrl, `/api/rides/${rideId}/status`, {
        method: 'PATCH',
        token,
        body: { status },
      });
      await loadAll();
    } catch (error) {
      Alert.alert('Actualizar viaje', error.message);
    } finally {
      setBusyId(null);
    }
  }

  const isAvailable = Boolean(profile?.is_available);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadAll} />}
    >
      <Text style={styles.title}>Conductor</Text>
      <Text style={styles.subtitle}>Acepta servicios y actualiza tu disponibilidad.</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{profile?.name || 'Perfil'}</Text>
        <PrimaryButton
          busy={busyId === 'availability'}
          label={isAvailable ? 'Pausar disponibilidad' : 'Activar disponibilidad'}
          onPress={() => updateAvailability(!isAvailable)}
        />
      </View>

      <ListSection
        empty="No hay viajes solicitados."
        items={available}
        renderItem={ride => (
          <RideCard
            key={ride.id}
            ride={ride}
            viewerRole="conductor"
            footer={(
              <View style={styles.actionsColumn}>
                <PrimaryButton busy={busyId === `accept-${ride.id}`} label="Aceptar precio" onPress={() => acceptRide(ride.id)} />
                <Field
                  keyboardType="numeric"
                  label="Tu precio"
                  value={offerPrices[ride.id] ?? String(Math.max(3000, Number(ride.estimated_price || 3000)))}
                  onChangeText={value => setOfferPrices(current => ({ ...current, [ride.id]: value }))}
                />
                <SecondaryActionButton
                  busy={busyId === `offer-${ride.id}`}
                  label="Enviar contraoferta"
                  onPress={() => offerRidePrice(ride.id)}
                />
              </View>
            )}
          />
        )}
        title="Viajes disponibles"
      />

      <ListSection
        empty="Aun no tienes viajes asignados."
        items={myRides}
        renderItem={ride => (
          <RideCard
            key={ride.id}
            ride={ride}
            viewerRole="conductor"
            footer={(
              <View style={styles.actionsColumn}>
                {ride.status === 'aceptado' ? (
                  <PrimaryButton busy={busyId === `en_camino-${ride.id}`} label="Marcar en camino" onPress={() => updateStatus(ride.id, 'en_camino')} />
                ) : null}
                {['aceptado', 'en_camino'].includes(ride.status) ? (
                  <PrimaryButton busy={busyId === `finalizado-${ride.id}`} label="Finalizar" onPress={() => updateStatus(ride.id, 'finalizado')} />
                ) : null}
                {ride.status === 'ofertado' ? (
                  <Text style={styles.detail}>Esperando aceptacion del cliente.</Text>
                ) : null}
                {['solicitado', 'ofertado', 'aceptado', 'en_camino'].includes(ride.status) ? (
                  <DangerButton busy={busyId === `cancelado-${ride.id}`} label="Cancelar" onPress={() => updateStatus(ride.id, 'cancelado')} />
                ) : null}
              </View>
            )}
          />
        )}
        title="Mis servicios"
      />
    </ScrollView>
  );
}

function AdminScreen({ apiBaseUrl, token }) {
  const [tab, setTab] = useState('summary');
  const [userRoleFilter, setUserRoleFilter] = useState('cliente');
  const [rideStatusFilter, setRideStatusFilter] = useState('all');
  const [ridePhoneQuery, setRidePhoneQuery] = useState('');
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [rides, setRides] = useState([]);
  const [tables, setTables] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const badRatingAlertedRef = useRef(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setRefreshing(true);
    try {
      const [summaryData, usersData, driversData, ridesData, tablesData] = await Promise.all([
        apiRequest(apiBaseUrl, '/api/admin/summary', { token }),
        apiRequest(apiBaseUrl, '/api/admin/users', { token }),
        apiRequest(apiBaseUrl, '/api/admin/drivers', { token }),
        apiRequest(apiBaseUrl, '/api/admin/rides', { token }),
        apiRequest(apiBaseUrl, '/api/admin/tables', { token }),
      ]);
      setSummary(summaryData);
      setUsers(usersData);
      setDrivers(driversData);
      setRides(ridesData);
      setTables(tablesData);

      const badRatedRides = ridesData.filter(ride => ride.driver_service_rating === 'malo');
      if (badRatedRides.length > 0 && !badRatingAlertedRef.current) {
        badRatingAlertedRef.current = true;
        Alert.alert(
          'Calificaciones malas',
          `Hay ${badRatedRides.length} servicio${badRatedRides.length === 1 ? '' : 's'} calificado${badRatedRides.length === 1 ? '' : 's'} como malo. Revisa Calificacion para poner todo en orden.`
        );
      }
    } catch (error) {
      Alert.alert('Administrador', error.message);
    } finally {
      setRefreshing(false);
    }
  }

  function confirmDeleteUser(item) {
    const label = item.name || item.phone || `ID ${item.id}`;
    Alert.alert(
      'Eliminar usuario',
      `Quieres eliminar a ${label}? Esta accion tambien ajusta sus datos asociados.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => deleteUser(item.id),
        },
      ],
    );
  }

  async function deleteUser(userId) {
    setDeletingId(userId);
    try {
      await apiCommand(apiBaseUrl, `/api/admin/users/${userId}/delete`, {
        method: 'POST',
        token,
      });
      await loadAll();
      Alert.alert('Administrador', 'Usuario eliminado.');
    } catch (error) {
      Alert.alert('Administrador', error.message);
    } finally {
      setDeletingId(null);
    }
  }

  function showUsers(role = 'cliente') {
    setUserRoleFilter(role);
    setTab('users');
  }

  function showRides(status = 'all') {
    setRideStatusFilter(status);
    setTab('rides');
  }

  function handleSummarySelect(target, filter) {
    if (target === 'users') showUsers(filter || 'cliente');
    if (target === 'drivers') setTab('drivers');
    if (target === 'rides') showRides(filter || 'all');
  }

  const filteredUsers = users.filter(user => (
    userRoleFilter === 'all' ? user.role !== 'conductor' : user.role === userRoleFilter
  ));

  const filteredRides = rides.filter(ride => {
    const matchesStatus = rideStatusFilter === 'all'
      || (rideStatusFilter === 'rating' && ride.driver_service_rating)
      || (rideStatusFilter === 'rating_bad' && ride.driver_service_rating === 'malo')
      || ride.status === rideStatusFilter;
    const cleanQuery = ridePhoneQuery.replace(/\D/g, '');
    const clientPhone = String(ride.client_phone || '').replace(/\D/g, '');
    const driverPhone = String(ride.driver_phone || '').replace(/\D/g, '');
    const matchesPhone = !cleanQuery || clientPhone.includes(cleanQuery) || driverPhone.includes(cleanQuery);
    return matchesStatus && matchesPhone;
  });

  const userTitle = userRoleFilter === 'admin' ? 'Administradores' : userRoleFilter === 'all' ? 'Usuarios' : 'Clientes';
  const rideTitle = rideStatusFilter === 'all'
    ? 'Viajes'
    : rideStatusFilter === 'rating'
      ? 'Viajes con calificacion'
      : rideStatusFilter === 'rating_bad'
        ? 'Calificaciones malas'
    : `Viajes ${rideStatusFilter.replace('_', ' ')}`;

  const content = useMemo(() => {
    if (tab === 'summary') return <SummaryGrid summary={summary} onSelect={handleSummarySelect} />;
    if (tab === 'users') return <AdminList deletingId={deletingId} items={filteredUsers} empty="Sin usuarios" onDelete={confirmDeleteUser} title={userTitle} />;
    if (tab === 'drivers') return <AdminList deletingId={deletingId} items={drivers} empty="Sin conductores" onDelete={confirmDeleteUser} title="Conductores" />;
    if (tab === 'rides') {
      return (
        <AdminRidesList
          empty="Sin viajes"
          items={filteredRides}
          phoneQuery={ridePhoneQuery}
          statusFilter={rideStatusFilter}
          title={rideTitle}
          onPhoneQueryChange={setRidePhoneQuery}
          onStatusFilterChange={setRideStatusFilter}
        />
      );
    }
    return <AdminList items={tables} empty="Sin tablas" title="Tablas" />;
  }, [tab, summary, filteredUsers, drivers, filteredRides, tables, deletingId, userTitle, rideTitle, ridePhoneQuery, rideStatusFilter]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadAll} />}
    >
      <Text style={styles.title}>Administrador</Text>
      <Text style={styles.subtitle}>Vista general de la base de datos.</Text>
      <SegmentedControl
        value={tab}
        options={[
          { value: 'summary', label: 'Resumen' },
          { value: 'users', label: 'Usuarios' },
          { value: 'drivers', label: 'Conductores' },
          { value: 'rides', label: 'Viajes' },
          { value: 'tables', label: 'Tablas' },
        ]}
        onChange={nextTab => {
          if (nextTab === 'users') setUserRoleFilter('cliente');
          if (nextTab === 'rides') setRideStatusFilter('all');
          setTab(nextTab);
        }}
      />
      {content}
    </ScrollView>
  );
}

function PasswordModal({ busy, form, onCancel, onChange, onSubmit, visible }) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.sectionTitle}>Cambiar contraseña</Text>
          <Field
            label="Contraseña actual"
            secureTextEntry
            value={form.current}
            onChangeText={value => onChange(current => ({ ...current, current: value }))}
          />
          <Field
            label="Nueva contraseña"
            secureTextEntry
            value={form.next}
            onChangeText={value => onChange(current => ({ ...current, next: value }))}
          />
          <Field
            label="Confirmar nueva contraseña"
            secureTextEntry
            value={form.confirmation}
            onChangeText={value => onChange(current => ({ ...current, confirmation: value }))}
          />
          <PrimaryButton busy={busy} label="Actualizar contraseña" onPress={onSubmit} />
          <SecondaryActionButton label="Cancelar" onPress={onCancel} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SummaryGrid({ onSelect, summary }) {
  const entries = [
    ['Usuarios', summary?.users_count, 'users', 'all'],
    ['Clientes', summary?.clients_count, 'users', 'cliente'],
    ['Conductores', summary?.drivers_count, 'drivers'],
    ['Admins', summary?.admins_count, 'users', 'admin'],
    ['Viajes', summary?.rides_count, 'rides', 'all'],
    ['Solicitados', summary?.requested_rides, 'rides', 'solicitado'],
    ['Ofertados', summary?.offered_rides, 'rides', 'ofertado'],
    ['Aceptados', summary?.accepted_rides, 'rides', 'aceptado'],
    ['En camino', summary?.active_rides, 'rides', 'en_camino'],
    ['Finalizados', summary?.finished_rides, 'rides', 'finalizado'],
    ['Cancelados', summary?.canceled_rides, 'rides', 'cancelado'],
    ['Calificacion', summary?.rated_rides, 'rides', 'rating'],
    ['Malos', summary?.bad_rated_rides, 'rides', 'rating_bad'],
  ];

  return (
    <View style={styles.summaryGrid}>
      {entries.map(([label, value, target, filter]) => (
        <TouchableOpacity activeOpacity={0.82} key={label} onPress={() => onSelect(target, filter)} style={styles.metricCard}>
          <Text style={styles.metricValue}>{value ?? '-'}</Text>
          <Text style={styles.metricLabel}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function AdminRidesList({ empty, items, onPhoneQueryChange, onStatusFilterChange, phoneQuery, statusFilter, title }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Field
        keyboardType="phone-pad"
        label="Buscar por telefono"
        value={phoneQuery}
        onChangeText={onPhoneQueryChange}
      />
      <SegmentedControl
        value={statusFilter}
        options={[
          { value: 'all', label: 'Todos' },
          { value: 'solicitado', label: 'Solicitados' },
          { value: 'ofertado', label: 'Ofertados' },
          { value: 'aceptado', label: 'Aceptados' },
          { value: 'en_camino', label: 'En camino' },
          { value: 'finalizado', label: 'Finalizados' },
          { value: 'cancelado', label: 'Cancelados' },
          { value: 'rating', label: 'Calificacion' },
          { value: 'rating_bad', label: 'Malos' },
        ]}
        onChange={onStatusFilterChange}
      />
      {items.length === 0 ? <Text style={styles.empty}>{empty}</Text> : null}
      {items.map((ride, index) => (
        <View key={`Viajes-${ride.id || index}`} style={styles.dbRow}>
          <Text style={styles.dbText}><Text style={styles.dbKey}>id: </Text>{formatValue(ride.id)}</Text>
          <Text style={styles.dbText}><Text style={styles.dbKey}>estado: </Text>{formatValue(ride.status)}</Text>
          <Text style={styles.dbText}><Text style={styles.dbKey}>cliente: </Text>{formatValue(ride.client_name)}</Text>
          <Text style={styles.dbText}><Text style={styles.dbKey}>telefono cliente: </Text>{formatValue(ride.client_phone)}</Text>
          <Text style={styles.dbText}><Text style={styles.dbKey}>conductor: </Text>{formatValue(ride.driver_name)}</Text>
          <Text style={styles.dbText}><Text style={styles.dbKey}>telefono conductor: </Text>{formatValue(ride.driver_phone)}</Text>
          <Text style={styles.dbText}><Text style={styles.dbKey}>recogida: </Text>{formatValue(ride.pickup_address)}</Text>
          <Text style={styles.dbText}><Text style={styles.dbKey}>destino: </Text>{formatValue(ride.destination_address)}</Text>
          <Text style={styles.dbText}><Text style={styles.dbKey}>precio: </Text>{formatValue(ride.estimated_price)}</Text>
          <Text style={styles.dbText}><Text style={styles.dbKey}>calificacion: </Text>{formatValue(ride.driver_service_rating)}</Text>
          <Text style={styles.dbText}><Text style={styles.dbKey}>motivo: </Text>{formatValue(ride.driver_service_comment)}</Text>
          <Text style={styles.dbText}><Text style={styles.dbKey}>fecha: </Text>{formatValue(ride.created_at)}</Text>
        </View>
      ))}
    </View>
  );
}

function AdminList({ deletingId, empty, items, onDelete, title }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.length === 0 ? <Text style={styles.empty}>{empty}</Text> : null}
      {items.map((item, index) => (
        <View key={`${title}-${item.id || index}`} style={styles.dbRow}>
          {Object.entries(item).map(([key, value]) => (
            <Text key={key} style={styles.dbText}>
              <Text style={styles.dbKey}>{key}: </Text>{formatValue(value)}
            </Text>
          ))}
          {onDelete ? (
            <View style={styles.dbActions}>
              <DangerButton
                busy={deletingId === item.id}
                label="Eliminar"
                onPress={() => onDelete(item)}
              />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function ListSection({ empty, items, renderItem, title }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.length === 0 ? <Text style={styles.empty}>{empty}</Text> : null}
      {items.map(renderItem)}
    </View>
  );
}

function RideCard({ footer, ride, viewerRole = 'cliente' }) {
  const clientPrice = Number(ride.estimated_price || 0);
  const driverOfferPrice = Number(ride.driver_offer_price || 0);
  const displayPrice = ride.status === 'ofertado' && driverOfferPrice > 0 ? driverOfferPrice : clientPrice;
  const hasDriver = Boolean(ride.driver_name || ride.driver_phone || ride.vehicle_plate);
  const driverTitle = ride.status === 'ofertado' ? 'Contraoferta del conductor' : 'Conductor asignado';
  const isDriverView = viewerRole === 'conductor';
  const canDriverCallClient = isDriverView
    && Boolean(ride.client_phone)
    && ['ofertado', 'aceptado', 'en_camino', 'finalizado'].includes(ride.status)
    && Boolean(ride.driver_id);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.rideTitle}>Viaje #{ride.id}</Text>
        <Text style={styles.badge}>{ride.status}</Text>
      </View>
      <Text style={styles.detail}>Cliente: {ride.client_name || ride.client_id}</Text>
      <Text style={styles.detail}>Recogida: {ride.pickup_address}</Text>
      <Text style={styles.detail}>Destino: {ride.destination_address}</Text>
      <Text style={styles.price}>${displayPrice.toLocaleString('es-CO')}</Text>
      {ride.status === 'ofertado' && driverOfferPrice > 0 ? (
        <Text style={styles.detail}>Oferta inicial: ${clientPrice.toLocaleString('es-CO')}</Text>
      ) : null}
      {ride.driver_service_rating ? (
        <Text style={styles.detail}>
          Calificacion del servicio: {ride.driver_service_rating}
          {ride.driver_service_comment ? ` - ${ride.driver_service_comment}` : ''}
        </Text>
      ) : null}
      {canDriverCallClient ? (
        <View style={styles.driverPanel}>
          <View style={styles.driverPanelHeader}>
            <View style={styles.driverAvatar}>
              <Text style={styles.driverAvatarText}>{String(ride.client_name || 'C').slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.driverTitleWrap}>
              <Text style={styles.driverPanelLabel}>Cliente</Text>
              <Text style={styles.driverName}>{ride.client_name || 'Cliente'}</Text>
            </View>
          </View>

          <InfoChip label="Celular" value={ride.client_phone} />

          <SecondaryActionButton
            label="Llamar cliente"
            onPress={() => Linking.openURL(`tel:${ride.client_phone}`)}
          />
        </View>
      ) : null}
      {!isDriverView && hasDriver ? (
        <View style={styles.driverPanel}>
          <View style={styles.driverPanelHeader}>
            <View style={styles.driverAvatar}>
              <Text style={styles.driverAvatarText}>{String(ride.driver_name || 'C').slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.driverTitleWrap}>
              <Text style={styles.driverPanelLabel}>{driverTitle}</Text>
              <Text style={styles.driverName}>{ride.driver_name || 'Conductor'}</Text>
            </View>
          </View>

          <View style={styles.driverInfoGrid}>
            <InfoChip label="Placa" value={ride.vehicle_plate || '-'} />
            <InfoChip label="Celular" value={ride.driver_phone || '-'} />
            <InfoChip label="Rating" value={ride.driver_rating ? Number(ride.driver_rating).toFixed(1) : '5.0'} />
            <InfoChip label="Estado" value={ride.driver_is_available === false ? 'Ocupado' : 'Disponible'} />
          </View>

          {ride.driver_phone ? (
            <SecondaryActionButton
              label="Llamar conductor"
              onPress={() => Linking.openURL(`tel:${ride.driver_phone}`)}
            />
          ) : null}
        </View>
      ) : null}
      {footer ? <View style={styles.cardFooter}>{footer}</View> : null}
    </View>
  );
}

function InfoChip({ label, value }) {
  return (
    <View style={styles.infoChip}>
      <Text style={styles.infoChipLabel}>{label}</Text>
      <Text style={styles.infoChipValue}>{value}</Text>
    </View>
  );
}

function Field({ label, style, ...props }) {
  return (
    <View style={[styles.fieldWrap, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor="#8A98A8"
        style={styles.input}
        {...props}
      />
    </View>
  );
}

function PrimaryButton({ busy, label, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.82} disabled={busy} onPress={onPress} style={[styles.primaryButton, busy && styles.disabledButton]}>
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function DangerButton({ busy, label, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.82} disabled={busy} onPress={onPress} style={[styles.dangerButton, busy && styles.disabledButton]}>
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function SecondaryActionButton({ busy, label, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.82} disabled={busy} onPress={onPress} style={[styles.secondaryActionButton, busy && styles.disabledButton]}>
      {busy ? <ActivityIndicator color="#17202A" /> : <Text style={styles.secondaryActionText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function IconButton({ label, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={styles.iconButton}>
      <Text style={styles.iconButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function SegmentedControl({ onChange, options, value }) {
  return (
    <View style={styles.segment}>
      {options.map(option => (
        <TouchableOpacity
          activeOpacity={0.82}
          key={option.value}
          onPress={() => onChange(option.value)}
          style={[styles.segmentItem, value === option.value && styles.segmentItemActive]}
        >
          <Text style={[styles.segmentText, value === option.value && styles.segmentTextActive]}>{option.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function formatValue(value) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'si' : 'no';
  return String(value);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },
  keyboardAvoider: {
    flex: 1,
  },
  loadingScreen: {
    alignItems: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    padding: 24,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(23, 32, 42, 0.55)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    maxWidth: 480,
    padding: 20,
    width: '100%',
  },
  topBar: {
    alignItems: 'center',
    backgroundColor: '#F7F9FC',
    borderBottomColor: '#D9E2EC',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  topTitleWrap: {
    flex: 1,
  },
  brand: {
    color: '#17202A',
    fontSize: 23,
    fontWeight: '900',
  },
  statusLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 5,
  },
  statusSmall: {
    color: '#5D6D7E',
    flex: 1,
    fontSize: 12,
  },
  userLine: {
    color: '#146C5F',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D9E2EC',
    borderRadius: 8,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    minWidth: 48,
    paddingHorizontal: 9,
  },
  iconButtonText: {
    color: '#17202A',
    fontSize: 12,
    fontWeight: '900',
  },
  container: {
    padding: 18,
    paddingBottom: 42,
  },
  authContainer: {
    flexGrow: 1,
    paddingBottom: 160,
  },
  title: {
    color: '#17202A',
    fontSize: 32,
    fontWeight: '900',
  },
  subtitle: {
    color: '#5D6D7E',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 18,
    marginTop: 6,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D9E2EC',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardFooter: {
    marginTop: 12,
  },
  driverPanel: {
    backgroundColor: '#F0F8F6',
    borderColor: '#B8DCD3',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  driverPanelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  driverAvatar: {
    alignItems: 'center',
    backgroundColor: '#146C5F',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  driverAvatarText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  driverTitleWrap: {
    flex: 1,
  },
  driverPanelLabel: {
    color: '#146C5F',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  driverName: {
    color: '#17202A',
    fontSize: 17,
    fontWeight: '900',
    marginTop: 2,
  },
  driverInfoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  infoChip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D9E2EC',
    borderRadius: 9,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  infoChipLabel: {
    color: '#5D6D7E',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  infoChipValue: {
    color: '#17202A',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 3,
  },
  section: {
    marginTop: 8,
  },
  sectionTitle: {
    color: '#17202A',
    fontSize: 19,
    fontWeight: '900',
    marginBottom: 12,
  },
  fieldWrap: {
    marginBottom: 12,
  },
  fieldLabel: {
    color: '#5D6D7E',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D9E2EC',
    borderRadius: 10,
    borderWidth: 1,
    color: '#17202A',
    fontSize: 16,
    height: 48,
    paddingHorizontal: 12,
  },
  grid2: {
    flexDirection: 'row',
    gap: 10,
  },
  gridField: {
    flex: 1,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#146C5F',
    borderRadius: 10,
    height: 50,
    justifyContent: 'center',
    marginTop: 4,
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#B42318',
    borderRadius: 10,
    height: 50,
    justifyContent: 'center',
    marginTop: 4,
  },
  secondaryActionButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#146C5F',
    borderRadius: 10,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    marginTop: 4,
  },
  disabledButton: {
    opacity: 0.72,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryActionText: {
    color: '#146C5F',
    fontSize: 15,
    fontWeight: '900',
  },
  segment: {
    backgroundColor: '#EAF0F6',
    borderRadius: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
    padding: 5,
  },
  segmentItem: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 92,
    paddingHorizontal: 6,
  },
  segmentItemActive: {
    backgroundColor: '#146C5F',
  },
  segmentText: {
    color: '#5D6D7E',
    fontSize: 13,
    fontWeight: '900',
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  dot: {
    backgroundColor: '#A7B0BA',
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  dotOk: {
    backgroundColor: '#146C5F',
  },
  dotError: {
    backgroundColor: '#B42318',
  },
  detail: {
    color: '#5D6D7E',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 2,
  },
  footer: {
    color: '#5D6D7E',
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
  },
  empty: {
    color: '#5D6D7E',
    fontSize: 14,
    marginBottom: 12,
  },
  rideTitle: {
    color: '#17202A',
    fontSize: 18,
    fontWeight: '900',
  },
  badge: {
    backgroundColor: '#E7F5F1',
    borderRadius: 8,
    color: '#146C5F',
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  price: {
    color: '#17202A',
    fontSize: 17,
    fontWeight: '900',
    marginTop: 8,
  },
  actionsColumn: {
    gap: 8,
  },
  ratingPanel: {
    backgroundColor: '#F7F9FC',
    borderColor: '#D9E2EC',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  ratingTitle: {
    color: '#17202A',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 8,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D9E2EC',
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    padding: 14,
  },
  metricValue: {
    color: '#146C5F',
    fontSize: 26,
    fontWeight: '900',
  },
  metricLabel: {
    color: '#5D6D7E',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 4,
  },
  dbRow: {
    borderTopColor: '#EAF0F6',
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  dbText: {
    color: '#17202A',
    fontSize: 13,
    lineHeight: 20,
  },
  dbActions: {
    marginTop: 10,
  },
  dbKey: {
    color: '#5D6D7E',
    fontWeight: '900',
  },
});
