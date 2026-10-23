import { useAuth } from '../../context/AuthContext.jsx';
import { useReport } from '../../lib/useReport.js';
import { fmtHours, fmtPct } from '../../lib/format.js';
import { STATUS_LABELS } from '../../lib/tickets.js';
import { BarList, StatTile, VolumeChart } from '../../components/charts.jsx';
import ReportFilters, { useReportFilters } from '../../components/ReportFilters.jsx';
import ReportSection from '../../components/ReportSection.jsx';
import { PageHeader } from '../../components/ui.jsx';

// A staff member's own numbers: tickets assigned to them, within their projects.
export default function StatsPage() {
  const { projects, activeProjectId } = useAuth();
  const filters = useReportFilters();
  const q = useReport('me', '/reports/me', filters.params, filters.valid);

  return (
    <div className="space-y-10">
      <PageHeader title="My stats" subtitle="Tickets assigned to you. Times are UTC." />
      <ReportFilters filters={filters} projects={activeProjectId === 'ALL' ? projects : null} />

      <ReportSection id="mine" title="At a glance" query={q}>
        {(s) => (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            <StatTile label="Assigned to you, open now" value={s.totals.openNow} />
            <StatTile label="Tickets resolved" value={s.totals.resolved} hint="in this period" />
            <StatTile
              label="Tickets received"
              value={s.totals.created}
              hint="created in this period"
            />
            <StatTile
              label="Customer satisfaction"
              value={s.csat.average ? `${s.csat.average.toFixed(2)} / 5` : '—'}
              hint={`${s.csat.count} rating${s.csat.count === 1 ? '' : 's'}`}
            />
            <StatTile
              label="Avg first response"
              value={fmtHours(s.responseTimes.firstResponse.avgHours)}
              hint={`median ${fmtHours(s.responseTimes.firstResponse.medianHours)}`}
            />
            <StatTile
              label="Avg resolution time"
              value={fmtHours(s.responseTimes.resolution.avgHours)}
              hint="excludes time waiting on customers"
            />
            <StatTile
              label="SLA: first response"
              value={fmtPct(s.sla.firstResponse.rate)}
              hint={`${s.sla.firstResponse.met} of ${s.sla.firstResponse.total} on time`}
            />
            <StatTile
              label="SLA: resolution"
              value={fmtPct(s.sla.resolution.rate)}
              hint={`${s.sla.resolution.met} of ${s.sla.resolution.total} on time`}
            />
          </div>
        )}
      </ReportSection>

      <ReportSection id="mine-vol" title="Your ticket volume" query={q}>
        {(s) => (
          <VolumeChart
            series={s.series}
            granularity={s.range.granularity}
            title="Your ticket volume"
          />
        )}
      </ReportSection>

      <div className="grid gap-10 lg:grid-cols-2">
        <ReportSection id="mine-status" title="Your tickets by status" query={q}>
          {(s) => (
            <BarList
              ariaLabel="Your tickets by status"
              items={s.statuses.map((x) => ({
                key: x.status,
                label: STATUS_LABELS[x.status],
                value: x.count,
              }))}
              empty="No tickets are assigned to you."
            />
          )}
        </ReportSection>
        <ReportSection id="mine-csat" title="Your ratings" query={q}>
          {(s) => (
            <BarList
              ariaLabel="Your ratings by stars"
              empty="No ratings in this period."
              items={[...s.csat.distribution].reverse().map((d) => ({
                key: d.rating,
                label: `${d.rating} star${d.rating > 1 ? 's' : ''}`,
                value: d.count,
              }))}
            />
          )}
        </ReportSection>
      </div>
    </div>
  );
}
