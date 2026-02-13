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

    useEffect(() => {
        if (token) {
            api.getMe()
                .then(u => { setUser(u); setLoading(false); })
                .catch(() => { setToken(null); localStorage.removeItem('token'); setLoading(false); });
        } else {
            setLoading(false);
        }
    }, [token]);

    const login = async (username: string, password: string) => {
        const res = await api.login(username, password);
        localStorage.setItem('token', res.access_token);
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
        localStorage.removeItem('token');
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
