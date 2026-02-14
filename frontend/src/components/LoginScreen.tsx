import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getUiErrorFeedback } from '../utils/errorMessaging';

const AVATAR_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#00ACC1', '#6366f1'];

export default function LoginScreen() {
    const { login, register } = useAuth();
    const [isLogin, setIsLogin] = useState(true);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [avatarColor, setAvatarColor] = useState('#00ACC1');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            if (isLogin) {
                await login(username, password);
            } else {
                await register({ username, password, full_name: fullName || username, email: email || undefined, avatar_color: avatarColor });
            }
        } catch (err: unknown) {
            const feedback = getUiErrorFeedback(err, 'No se pudo iniciar sesión.');
            setError(`${feedback.message} ${feedback.actionLabel}.`);
        }
        setLoading(false);
    };

    return (
        <div className="login-screen">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-logo">
                        <i className="fas fa-microchip"></i>
                    </div>
                    <h1>Nanotronics</h1>
                    <p>Sistema de Reparaciones</p>
                </div>

                <div className="login-tabs">
                    <button className={`login-tab ${isLogin ? 'active' : ''}`} onClick={() => setIsLogin(true)}>
                        <i className="fas fa-sign-in-alt"></i> Ingresar
                    </button>
                    <button className={`login-tab ${!isLogin ? 'active' : ''}`} onClick={() => setIsLogin(false)}>
                        <i className="fas fa-user-plus"></i> Registrarse
                    </button>
                </div>

                {error && <div className="login-error"><i className="fas fa-exclamation-triangle"></i> {error}</div>}

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label><i className="fas fa-user"></i> Usuario</label>
                        <input type="text" value={username} onChange={e => setUsername(e.target.value)} required placeholder="admin" autoFocus />
                    </div>
                    <div className="form-group">
                        <label><i className="fas fa-lock"></i> Contraseña</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••" />
                    </div>

                    {!isLogin && (
                        <>
                            <div className="form-group">
                                <label><i className="fas fa-id-card"></i> Nombre completo</label>
                                <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Juan Pérez" />
                            </div>
                            <div className="form-group">
                                <label><i className="fas fa-envelope"></i> Email (opcional)</label>
                                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="juan@email.com" />
                            </div>
                            <div className="form-group">
                                <label><i className="fas fa-palette"></i> Color de avatar</label>
                                <div className="avatar-colors">
                                    {AVATAR_COLORS.map(c => (
                                        <button key={c} type="button" className={`avatar-color-btn ${avatarColor === c ? 'selected' : ''}`}
                                            style={{ background: c }} onClick={() => setAvatarColor(c)} />
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    <button type="submit" className="login-submit" disabled={loading}>
                        {loading ? <><i className="fas fa-spinner fa-spin"></i> Espere...</> : isLogin ? 'Ingresar' : 'Crear cuenta'}
                    </button>

                    {isLogin && (
                        <p className="login-hint">
                            <i className="fas fa-info-circle"></i> Primera vez? Credenciales: <strong>admin / admin123</strong>
                        </p>
                    )}
                </form>
            </div>
        </div>
    );
}
