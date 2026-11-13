import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend,
  ReferenceLine,
} from 'recharts';

interface StudentAttendanceChartProps {
  data: any[];
}

export const StudentAttendanceChart: React.FC<StudentAttendanceChartProps> = ({ data }) => {
  return (
    <div className="h-64 sm:h-72 w-full pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 20, left: -15, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="dayLabel"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={{ stroke: '#cbd5e1' }}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            unit="%"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={{ stroke: '#cbd5e1' }}
          />
          <RechartsTooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const item = payload[0].payload;
                return (
                  <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl border border-slate-700 text-xs min-w-44">
                    <div className="font-bold text-amber-400 border-b border-slate-700 pb-1 mb-2 flex items-center justify-between">
                      <span>{item.rawDate || item.dayLabel}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-black ${
                          item.isPresent
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}
                      >
                        {item.isPresent ? 'उपस्थित (Present)' : 'अनुपस्थित (Absent)'}
                      </span>
                    </div>
                    <div className="space-y-1 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-slate-400">संचयी हाजिरी दर:</span>
                        <span className="font-bold text-blue-300">{item.attendanceRate}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">दैनिक स्वच्छता स्कोर:</span>
                        <span className="font-bold text-emerald-300">{item.hygieneScore}%</span>
                      </div>
                      {item.remark && (
                        <div className="pt-1 text-[10px] text-slate-300 italic border-t border-slate-800 mt-1">
                          शिक्षक रिमार्क: {item.remark}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />
          <RechartsLegend
            verticalAlign="top"
            height={32}
            wrapperStyle={{ fontSize: '11px', paddingTop: '0px' }}
          />
          <ReferenceLine
            y={75}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            label={{
              value: 'न्यूनतम 75% लक्ष्य',
              fill: '#b45309',
              fontSize: 10,
              position: 'insideTopRight',
            }}
          />
          <Line
            type="monotone"
            dataKey="attendanceRate"
            name="संचयी हाजिरी % (Attendance Trend)"
            stroke="#2563eb"
            strokeWidth={3}
            dot={{ r: 3, fill: '#1d4ed8', stroke: '#fff', strokeWidth: 1.5 }}
            activeDot={{ r: 6, fill: '#1e40af' }}
          />
          <Line
            type="stepAfter"
            dataKey="dailyStatus"
            name="दैनिक उपस्थिति (100=Present, 0=Absent)"
            stroke="#10b981"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={{ r: 2, fill: '#059669' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default StudentAttendanceChart;
