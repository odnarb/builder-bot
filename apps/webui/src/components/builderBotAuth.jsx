import React, { createContext, useContext, useMemo } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';

const LOCAL_USER = Object.freeze({
  sub: 'local:default',
  email: 'local@builderbot.local',
  name: 'Local Builder',
  picture: '',
});

const LOCAL_TOKEN = 'builderbot-local-dev-token';

const BuilderBotAuthContext = createContext(null);

/**
 * Return whether the Web UI should use hosted Auth0 mode.
 * @returns {boolean} True when hosted mode is explicitly configured.
 */
export function isHostedWebMode() {
  return String(import.meta.env.VITE_BUILDERBOT_DISTRIBUTION_MODE || 'local').trim().toLowerCase() === 'hosted';
}

/**
 * Provide Auth0 in hosted mode and a local identity in local mode.
 * @param {{ children: React.ReactNode }} props Provider props.
 * @returns {React.ReactElement} Auth provider.
 */
export function BuilderBotAuthProvider({ children }) {
  if (isHostedWebMode()) {
    return (
      <Auth0Provider
        domain={import.meta.env.VITE_AUTH0_DOMAIN}
        clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
        authorizationParams={{
          redirect_uri: window.location.origin,
          audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        }}
      >
        <HostedAuthBridge>{children}</HostedAuthBridge>
      </Auth0Provider>
    );
  }

  return (
    <BuilderBotAuthContext.Provider value={createLocalAuthValue()}>
      {children}
    </BuilderBotAuthContext.Provider>
  );
}

/**
 * Bridge hosted Auth0 state into the app auth context.
 * @param {{ children: React.ReactNode }} props Provider props.
 * @returns {React.ReactElement} Context provider.
 */
function HostedAuthBridge({ children }) {
  const auth = useAuth0();
  const value = useMemo(() => ({
    ...auth,
    isHosted: true,
    isLocal: false,
  }), [auth]);

  return (
    <BuilderBotAuthContext.Provider value={value}>
      {children}
    </BuilderBotAuthContext.Provider>
  );
}

/**
 * Build the local auth object used by the app.
 * @returns {Record<string, unknown>} Local auth state and actions.
 */
function createLocalAuthValue() {
  return {
    isHosted: false,
    isLocal: true,
    isAuthenticated: true,
    isLoading: false,
    user: LOCAL_USER,
    getAccessTokenSilently: async () => LOCAL_TOKEN,
    loginWithRedirect: async () => {},
    logout: () => {},
  };
}

/**
 * Read BuilderBot auth state.
 * @returns {Record<string, unknown>} Auth state and actions.
 * @throws {Error} When used outside BuilderBotAuthProvider.
 */
export function useBuilderBotAuth() {
  const value = useContext(BuilderBotAuthContext);
  if (!value) {
    throw new Error('useBuilderBotAuth must be used inside BuilderBotAuthProvider.');
  }
  return value;
}
