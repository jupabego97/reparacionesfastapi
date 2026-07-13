import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { api, AUTH_TOKEN_REFRESHED_EVENT } from '../api/client';
import type { UserInfo } from '../api/client';

interface AuthContextType {
    user: UserInfo | null;
    token: string | null;
    isAuthenticated: boolean;
    login: (username: string, password: string) => Promise<void>;
    register: (data: { username: string; password: string; full_name?: string; email?: string; avatar_color?: string }) => Promise<void>;
    refreshSession: () => Promise<boolean>;
    logout: () => void;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    token: null,
    isAuthenticated: false,
    login: async () => { },
    register: async () => { },
    refreshSession: async () => false,
    logout: () => { },
    loading: true,
});

const TOKEN_REFRESH_LEEWAY_MS = 5 * 60 * 1000;
const FALLBACK_REFRESH_DELAY_MS = 7 * 60 * 60 * 1000;

function getJwtExpiresAt(token: string): number | null {
    try {
        const payload = token.split('.')[1];
        if (!payload) return null;
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { exp?: number };
        return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
    } catch {
        return null;
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<UserInfo | null>(null);
    const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);

    const refreshSession = useCallback(async (): Promise<boolean> => {
        const deviceToken = localStorage.getItem('device_token');
        if (!deviceToken) return false;
        try {
            const res = await api.deviceLogin(deviceToken);
            localStorage.setItem('token', res.access_token);
            localStorage.setItem('device_token', res.device_token);
            setToken(res.access_token);
            setUser(res.user);
            return true;
        } catch {
            return false;
        }
    }, []);

    // Al iniciar: primero intenta el JWT existente; si falla, usa el device token
    useEffect(() => {
        const storedToken = localStorage.getItem('token');
        const deviceToken = localStorage.getItem('device_token');

        if (storedToken) {
            api.getMe()
                .then(u => {
                    setUser(u);
                    setToken(localStorage.getItem('token') || storedToken);
                    setLoading(false);
                })
                .catch(() => {
                    // JWT expirado — intentar auto-login con device token
                    localStorage.removeItem('token');
                    setToken(null);
                    if (deviceToken) {
                        api.deviceLogin(deviceToken)
                            .then(res => {
                                localStorage.setItem('token', res.access_token);
                                setToken(res.access_token);
                                setUser(res.user);
                                setLoading(false);
                            })
                            .catch(() => {
                                localStorage.removeItem('device_token');
                                setLoading(false);
                            });
                    } else {
                        setLoading(false);
                    }
                });
        } else if (deviceToken) {
            // No hay JWT pero sí device token — auto-login silencioso
            api.deviceLogin(deviceToken)
                .then(res => {
                    localStorage.setItem('token', res.access_token);
                    setToken(res.access_token);
                    setUser(res.user);
                    setLoading(false);
                })
                .catch(() => {
                    localStorage.removeItem('device_token');
                    setLoading(false);
                });
        } else {
            setLoading(false);
        }
    }, []);

    // Mantiene el estado React sincronizado si una petición HTTP renovó el JWT.
    useEffect(() => {
        const handleTokenRefresh = (event: Event) => {
            const nextToken = (event as CustomEvent<string>).detail;
            if (nextToken) setToken(nextToken);
        };
        window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefresh);
        return () => window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefresh);
    }, []);

    // Renueva antes del vencimiento y al volver de suspensión/background.
    useEffect(() => {
        if (!token || !localStorage.getItem('device_token')) return;
        const expiresAt = getJwtExpiresAt(token);
        const delay = expiresAt == null
            ? FALLBACK_REFRESH_DELAY_MS
            : Math.max(0, expiresAt - Date.now() - TOKEN_REFRESH_LEEWAY_MS);
        const timer = window.setTimeout(() => { void refreshSession(); }, delay);
        const refreshWhenVisible = () => {
            if (document.visibilityState !== 'visible') return;
            if (expiresAt == null || expiresAt - Date.now() <= TOKEN_REFRESH_LEEWAY_MS) {
                void refreshSession();
            }
        };
        document.addEventListener('visibilitychange', refreshWhenVisible);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener('visibilitychange', refreshWhenVisible);
        };
    }, [token, refreshSession]);

    const login = async (username: string, password: string) => {
        const res = await api.login(username, password);
        localStorage.setItem('token', res.access_token);
        localStorage.setItem('device_token', res.device_token);
        setToken(res.access_token);
        setUser(res.user);
    };

    const register = async (data: { username: string; password: string; full_name?: string; email?: string; avatar_color?: string }) => {
        const res = await api.register(data);
        localStorage.setItem('token', res.access_token);
        setToken(res.access_token);
        setUser(res.user);
    };

    const logout = () => {
        const deviceToken = localStorage.getItem('device_token');
        if (deviceToken) {
            // Revocar device token en backend (no esperamos respuesta)
            api.deviceLogout(deviceToken).catch(() => { });
        }
        localStorage.removeItem('token');
        localStorage.removeItem('device_token');
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, token, isAuthenticated: !!user, login, register, refreshSession, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
