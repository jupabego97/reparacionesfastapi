import { useState, useMemo } from 'react';
import type { Tarjeta } from '../api/client';

interface CalendarViewProps {
    tarjetas: Tarjeta[];
    onSelect: (t: Tarjeta) => void;
}

const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export default function CalendarView({ tarjetas, onSelect }: CalendarViewProps) {
    const [currentMonth, setCurrentMonth] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay();

    // Group tarjetas by due date
    const tarjetasByDate = useMemo(() => {
        const map: Record<string, Tarjeta[]> = {};
        tarjetas.forEach(t => {
            if (t.fecha_limite) {
                const key = t.fecha_limite.slice(0, 10); // YYYY-MM-DD
                if (!map[key]) map[key] = [];
                map[key].push(t);
            }
        });
        return map;
    }, [tarjetas]);

    const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const cells: React.ReactNode[] = [];
    // Empty cells for days before first day
    for (let i = 0; i < firstDayOfWeek; i++) {
        cells.push(<div key={`empty-${i}`} className="cal-cell cal-empty"></div>);
    }
    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayTarjetas = tarjetasByDate[dateKey] || [];
        const isToday = dateKey === todayKey;
        const hasOverdue = dayTarjetas.some(t => t.columna !== 'listos' && new Date(t.fecha_limite!) < today);

        cells.push(
            <div key={day} className={`cal-cell ${isToday ? 'cal-today' : ''} ${dayTarjetas.length > 0 ? 'cal-has-items' : ''}`}>
                <div className={`cal-day-number ${hasOverdue ? 'cal-overdue' : ''}`}>{day}</div>
                <div className="cal-items">
                    {dayTarjetas.slice(0, 3).map(t => (
                        <div
                            key={t.id}
                            className={`cal-item prio-${t.prioridad}`}
                            onClick={() => onSelect(t)}
                            title={`${t.nombre_propietario} - ${t.problema}`}
                        >
                            {t.nombre_propietario?.slice(0, 12)}
                        </div>
                    ))}
                    {dayTarjetas.length > 3 && (
                        <div className="cal-more">+{dayTarjetas.length - 3} más</div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="calendar-view">
            <div className="cal-header">
                <button className="cal-nav" onClick={prevMonth}><i className="fas fa-chevron-left"></i></button>
                <h3 className="cal-title">{MONTHS_ES[month]} {year}</h3>
                <button className="cal-nav" onClick={nextMonth}><i className="fas fa-chevron-right"></i></button>
            </div>
            <div className="cal-weekdays">
                {DAYS_ES.map(d => <div key={d} className="cal-weekday">{d}</div>)}
            </div>
            <div className="cal-grid">
                {cells}
            </div>
        </div>
    );
}
