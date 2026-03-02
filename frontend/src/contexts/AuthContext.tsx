import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api/client';
import type { UserInfo } from '../api/client';

interface AuthContextType {
    user: UserInfo | null;
    token: string | null;
    isAuthenticated: boolean;
    login: (username: string, password: string) => Promise<void>;
    register: (data: { username: string; password: string; full_name?: string; email?: string; avatar_color?: string }) => Promise<void>;
    logout: () => void;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    token: null,
    isAuthenticated: false,
    login: async () => { },
    register: async () => { },
    logout: () => { },
    loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<UserInfo | null>(null);
    const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);

    // Al iniciar: primero intenta el JWT existente; si falla, usa el device token
    useEffect(() => {
        const storedToken = localStorage.getItem('token');
        const deviceToken = localStorage.getItem('device_token');

        if (storedToken) {
            api.getMe()
                .then(u => { setUser(u); setToken(storedToken); setLoading(false); })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        <AuthContext.Provider value={{ user, token, isAuthenticated: !!user, login, register, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
