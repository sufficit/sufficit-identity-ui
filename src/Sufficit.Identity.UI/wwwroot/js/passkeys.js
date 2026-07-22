/* Sufficit Identity — Passkeys (WebAuthn) JS interop
 *
 * Blazor Server roda no servidor; navigator.credentials.create/get só existe
 * no browser. Estas funções são invocadas via IJSRuntime.InvokeAsync<...> do
 * Blazor, recebem as opções serializadas em JSON do server (geradas pelo
 * SignInManager.MakePasskeyCreationOptionsAsync / MakePasskeyRequestOptionsAsync),
 * chamam a WebAuthn API do browser, e retornam o resultado serializado para o
 * server processar via PerformPasskeyAttestationAsync / PerformPasskeyAssertionAsync.
 *
 * Encoding: WebAuthn usa ArrayBuffer (bytes) em muitos campos, mas JSON transporta
 * strings. Seguimos a convenção base64url (sem padding) para ida e volta.
 */

// ---- base64url helpers (sem dependências externas) ----

function base64urlToBuffer(base64url) {
    // Converte base64url → base64 → string binária → ArrayBuffer
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLen);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function bufferToBase64url(buffer) {
    // Converte ArrayBuffer → base64url (sem padding)
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodifica as opções recebidas do server, convertendo campos base64url
 * (challenge, user.id, id) para ArrayBuffer — que é o que a WebAuthn API espera.
 */
function decodeCreationOptions(optionsJson) {
    const opts = JSON.parse(optionsJson);
    if (opts.challenge) opts.challenge = base64urlToBuffer(opts.challenge);
    if (opts.user && opts.user.id) opts.user.id = base64urlToBuffer(opts.user.id);
    if (opts.excludeCredentials) {
        opts.excludeCredentials = opts.excludeCredentials.map(c => ({
            ...c,
            id: base64urlToBuffer(c.id),
        }));
    }
    return opts;
}

function decodeRequestOptions(optionsJson) {
    const opts = JSON.parse(optionsJson);
    if (opts.challenge) opts.challenge = base64urlToBuffer(opts.challenge);
    if (opts.allowCredentials) {
        opts.allowCredentials = opts.allowCredentials.map(c => ({
            ...c,
            id: base64urlToBuffer(c.id),
        }));
    }
    return opts;
}

/**
 * Serializa o PublicKeyCredential resultante para JSON (para o server processar).
 * Converte os campos ArrayBuffer (rawId, response.*) para base64url.
 */
function serializeCredential(credential) {
    const result = {
        id: credential.id,
        rawId: bufferToBase64url(credential.rawId),
        type: credential.type,
        response: {},
    };

    if (credential.response instanceof AuthenticatorAttestationResponse) {
        // Registro (navigator.credentials.create)
        result.response.clientDataJSON = bufferToBase64url(credential.response.clientDataJSON);
        result.response.attestationObject = bufferToBase64url(credential.response.attestationObject);
        if (credential.response.getTransports) {
            result.response.transports = credential.response.getTransports();
        }
        if (credential.response.getPublicKey) {
            result.response.publicKey = bufferToBase64url(credential.response.getPublicKey());
        }
        if (credential.response.getPublicKeyAlgorithm) {
            result.response.publicKeyAlgorithm = credential.response.getPublicKeyAlgorithm();
        }
        if (credential.response.getAuthenticatorData) {
            result.response.authenticatorData = bufferToBase64url(credential.response.getAuthenticatorData());
        }
    } else if (credential.response instanceof AuthenticatorAssertionResponse) {
        // Login (navigator.credentials.get)
        result.response.clientDataJSON = bufferToBase64url(credential.response.clientDataJSON);
        result.response.authenticatorData = bufferToBase64url(credential.response.authenticatorData);
        result.response.signature = bufferToBase64url(credential.response.signature);
        result.response.userHandle = credential.response.userHandle
            ? bufferToBase64url(credential.response.userHandle)
            : null;
    }

    if (credential.authenticatorAttachment) {
        result.authenticatorAttachment = credential.authenticatorAttachment;
    }

    // clientExtensionResults se existir
    if (credential.getClientExtensionResults) {
        result.clientExtensionResults = credential.getClientExtensionResults();
    }

    return result;
}

// ---- Funções expostas para Blazor (window.passkeys.*) ----

window.passkeys = window.passkeys || {};

/**
 * Inicia o fluxo de registro de passkey (attestation).
 * @param {string} creationOptionsJson — JSON serializado de PublicKeyCredentialCreationOptions
 *   (gerado pelo server, com campos binários em base64url)
 * @param {string} passkeyName — nome amigável que o usuário deu ao passkey
 * @returns {Promise<string>} JSON serializado do PublicKeyCredential resultante
 *   (para passar de volta ao server via PerformPasskeyAttestationAsync)
 * @throws {Error} se o browser não suportar WebAuthn ou o usuário cancelar
 */
window.passkeys.create = async function (creationOptionsJson, passkeyName) {
    if (!window.PublicKeyCredential) {
        throw new Error('Este navegador não suporta WebAuthn/passkeys.');
    }

    const options = decodeCreationOptions(creationOptionsJson);

    // Adiciona nome do passkey como extension (se suportado pelo browser/authenticator)
    // — alguns authenticators mostram este nome na UI de seleção.
    if (!options.extensions) options.extensions = {};

    let credential;
    try {
        credential = await navigator.credentials.create({ publicKey: options });
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            throw new Error('Operação cancelada ou expirada.');
        }
        throw err;
    }

    const serialized = serializeCredential(credential);
    serialized.name = passkeyName; // nome amigável definido pelo usuário
    return JSON.stringify(serialized);
};

/**
 * Inicia o fluxo de login por passkey (assertion).
 * @param {string} requestOptionsJson — JSON serializado de PublicKeyCredentialRequestOptions
 *   (gerado pelo server, com campos binários em base64url)
 * @returns {Promise<string>} JSON serializado do PublicKeyCredential resultante
 *   (para passar de volta ao server via PasskeySignInAsync)
 * @throws {Error} se o browser não suportar WebAuthn ou o usuário cancelar
 */
window.passkeys.get = async function (requestOptionsJson) {
    if (!window.PublicKeyCredential) {
        throw new Error('Este navegador não suportar WebAuthn/passkeys.');
    }

    const options = decodeRequestOptions(requestOptionsJson);

    let credential;
    try {
        credential = await navigator.credentials.get({ publicKey: options });
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            throw new Error('Operação cancelada ou expirada.');
        }
        throw err;
    }

    return JSON.stringify(serializeCredential(credential));
};

/**
 * Verifica se o browser suporta passkeys/WebAuthn.
 * Útil para a UI decidir se mostra ou esconde o botão de passkey.
 * @returns {Promise<boolean>}
 */
window.passkeys.isSupported = async function () {
    if (!window.PublicKeyCredential) return false;
    // isConnectedUserVerifyingPlatform: verifica se há um autenticador
    // de plataforma disponível (Windows Hello, Touch ID, Face ID, etc).
    // Não é mandatório (usuário pode usar security key USB/NFC/BLE),
    // mas indica que passkeys são realmente utilizáveis neste dispositivo.
    try {
        if (window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
            return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        }
    } catch (e) {
        // Fallback: assume suporte básico se PublicKeyCredential existe.
    }
    return true;
};
