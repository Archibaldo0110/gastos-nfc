// ===== GastosNFC - Autenticacion y hoja personal por usuario =====
const CLIENT_ID = "142369544324-r9o5p863jqrjm30cf39f0hjib677ru5u.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

// Se llama una vez que la libreria de Google (gsi/client) esta cargada
function initGoogleAuth(onTokenReady) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) {
        console.error("Error de login:", resp);
        return;
      }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (resp.expires_in * 1000) - 60000;
      localStorage.setItem('gastosnfc_token', accessToken);
      localStorage.setItem('gastosnfc_token_expiry', String(tokenExpiry));
      onTokenReady();
    }
  });
}

// Boton "Iniciar sesion" llama esto
function signIn() {
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

// Cierra sesion en este dispositivo (borra todo lo guardado localmente)
function signOut() {
  localStorage.removeItem('gastosnfc_token');
  localStorage.removeItem('gastosnfc_token_expiry');
  localStorage.removeItem('gastosnfc_sheet_id');
  accessToken = null;
  tokenExpiry = 0;
}

// Devuelve un token valido, renovando en silencio si ya expiro
async function getValidToken() {
  const storedExpiry = parseInt(localStorage.getItem('gastosnfc_token_expiry') || '0');

  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  if (Date.now() < storedExpiry) {
    accessToken = localStorage.getItem('gastosnfc_token');
    tokenExpiry = storedExpiry;
    return accessToken;
  }

  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) { reject(resp); return; }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (resp.expires_in * 1000) - 60000;
      localStorage.setItem('gastosnfc_token', accessToken);
      localStorage.setItem('gastosnfc_token_expiry', String(tokenExpiry));
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

// Si el usuario ya tiene hoja creada en ESTE dispositivo, la reusa.
// Si no, crea una hoja nueva en el Drive del usuario que inicio sesion.
async function getOrCreateSheet() {
  let sheetId = localStorage.getItem('gastosnfc_sheet_id');
  if (sheetId) return sheetId;

  const token = await getValidToken();

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      properties: { title: 'GastosNFC' },
      sheets: [{ properties: { title: 'Gastos' } }]
    })
  });

  const created = await createRes.json();
  if (!created.spreadsheetId) {
    throw new Error('No se pudo crear la hoja: ' + JSON.stringify(created));
  }
  sheetId = created.spreadsheetId;

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Gastos!A1:E1?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [["Fecha", "Monto", "Categoria", "Descripcion", "Usuario"]] })
    }
  );

  localStorage.setItem('gastosnfc_sheet_id', sheetId);
  return sheetId;
}

// Guarda un gasto en LA HOJA DEL USUARIO QUE INICIO SESION EN ESTE CELULAR
async function appendGasto(monto, categoria) {
  const token = await getValidToken();
  const sheetId = await getOrCreateSheet();

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Gastos!A:E:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [[ new Date().toISOString(), monto, categoria, categoria, "" ]]
      })
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error('Error al guardar: ' + JSON.stringify(err));
  }
  return res.json();
}

function hasAccountOnThisDevice() {
  return !!localStorage.getItem('gastosnfc_sheet_id') && !!localStorage.getItem('gastosnfc_token');
}
