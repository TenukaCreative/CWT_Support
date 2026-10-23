import { useAuth } from '../../context/AuthContext.jsx';
import { useExportTickets } from '../../lib/useExport.js';
import { useReport } from '../../lib/useReport.js';
import { fmtDay, fmtHours, fmtPct } from '../../lib/format.js';
import { STATUS_LABELS } from '../../lib/tickets.js';
import { BarList, StatTile, VolumeChart } from '../../components/charts.jsx';
import ReportFilters, { useReportFilters } from '../../components/ReportFilters.jsx';
import ReportSection, { MiniTable } from '../../components/ReportSection.jsx';
import { PageHeader, TableWrap, Td, Th } from '../../components/ui.jsx';

const OPEN = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'REOPENED'];

export default function AdminDashboardPage() {
  const { projects, activeProjectId } = useAuth();
  const filters = useReportFilters();
  const exporter = useExportTickets();
  const { params, valid } = filters;
  const overview = useReport('overview', '/reports/overview', params, valid);
  const csat = useReport('csat', '/reports/csat', params, valid);
  const deflection = useReport('deflection', '/reports/deflection', params, valid);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Dashboard"
        subtitle="How support is doing. Times are UTC; merged duplicates are not counted."
      />
      {/* One filter row for everything below. With a single project selected in the header the scope is already narrow. */}
      <ReportFilters filters={filters} projects={activeProjectId === 'ALL' ? projects : null}>
        <button
          type="button"
          className="btn-secondary ml-auto"
          disabled={exporter.busy || !valid}
          onClick={() => exporter.run(params)}
        >
          {exporter.busy ? 'Exporting…' : 'Export tickets (CSV)'}
        </button>
      </ReportFilters>

      <ReportSection
        id="kpi"
        title="At a glance"
        subtitle={
          overview.data &&
          `${fmtDay(overview.data.range.from)} to ${fmtDay(overview.data.range.to)}`
        }
        query={overview}
      >
        {(o) => (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatTile label="Tickets created" value={o.totals.created} />
            <StatTile label="Tickets resolved" value={o.totals.resolved} />
            <StatTile label="Open right now" value={o.totals.openNow} hint="all tickets in view" />
            <StatTile
              label="Avg first response"
              value={fmtHours(o.responseTimes.firstResponse.avgHours)}
              hint={`median ${fmtHours(o.responseTimes.firstResponse.medianHours)} · ${o.responseTimes.firstResponse.count} answered`}
            />
            <StatTile
              label="Avg resolution time"
              value={fmtHours(o.responseTimes.resolution.avgHours)}
              hint={`median ${fmtHours(o.responseTimes.resolution.medianHours)} · excludes time waiting on customers`}
            />
            <StatTile
              label="SLA: first response"
              value={fmtPct(o.sla.firstResponse.rate)}
              hint={`${o.sla.firstResponse.met} of ${o.sla.firstResponse.total} on time`}
            />
            <StatTile
              label="SLA: resolution"
              value={fmtPct(o.sla.resolution.rate)}
              hint={`${o.sla.resolution.met} of ${o.sla.resolution.total} on time`}
            />
            <StatTile
              label="Customer satisfaction"
              value={
                csat.data
                  ? csat.data.summary.average
                    ? `${csat.data.summary.average.toFixed(2)} / 5`
                    : '—'
                  : '…'
              }
              hint={
                csat.data
                  ? `${csat.data.summary.count} rating${csat.data.summary.count === 1 ? '' : 's'}`
                  : undefined
              }
            />
            <StatTile
              label="Reopen rate"
              value={fmtPct(o.totals.reopenRate)}
              hint={`${o.totals.reopens} reopened of ${o.totals.resolutionEvents} resolutions`}
            />
          </div>
        )}
      </ReportSection>

      <ReportSection
        id="volume"
        title="Ticket volume"
        subtitle={overview.data && `Created and resolved per ${overview.data.range.granularity}`}
        query={overview}
      >
        {(o) => <VolumeChart series={o.series} granularity={o.range.granularity} />}
      </ReportSection>

      <div className="grid gap-10 lg:grid-cols-2">
        <ReportSection
          id="status"
          title="Open vs resolved"
          subtitle="Current status of every ticket in view"
          query={overview}
        >
          {(o) => {
            const open = o.statuses
              .filter((s) => OPEN.includes(s.status))
              .reduce((n, s) => n + s.count, 0);
            const done = o.statuses.reduce((n, s) => n + s.count, 0) - open;
            return (
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  <strong>{open}</strong> open · <strong>{done}</strong> resolved or closed
                </p>
                <BarList
                  ariaLabel="Tickets by status"
                  items={o.statuses.map((s) => ({
                    key: s.status,
                    label: STATUS_LABELS[s.status],
                    value: s.count,
                  }))}
                />
              </div>
            );
          }}
        </ReportSection>
        <ReportSection
          id="cats"
          title="Top categories"
          subtitle="Tickets created in the period"
          query={overview}
        >
          {(o) => (
            <BarList
              ariaLabel="Tickets by category"
              items={o.categories.map((c) => ({ label: c.name, value: c.count }))}
              empty="No tickets were created in this period."
            />
          )}
        </ReportSection>
      </div>

      <ReportSection
        id="csat"
        title="Customer satisfaction"
        subtitle="Ratings given in the period"
        query={csat}
      >
        {(c) => (
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
              <div>
                <h3 className="mb-2 text-sm font-medium">Rating distribution</h3>
                <BarList
                  ariaLabel="Ratings by stars"
                  empty="No ratings in this period."
                  items={[...c.summary.distribution].reverse().map((d) => ({
                    key: d.rating,
                    label: `${d.rating} star${d.rating > 1 ? 's' : ''}`,
                    value: d.count,
                  }))}
                />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">By month</h3>
                <MiniTable label="Satisfaction by month" nameHeader="Month" rows={c.byMonth} />
              </div>
            </div>
            <div className="grid gap-6 lg:grid-cols-3">
              <div>
                <h3 className="mb-2 text-sm font-medium">By agent</h3>
                <MiniTable label="Satisfaction by agent" nameHeader="Agent" rows={c.byAgent} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">By project</h3>
                <MiniTable
                  label="Satisfaction by project"
                  nameHeader="Project"
                  rows={c.byProject}
                />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">By category</h3>
                <MiniTable
                  label="Satisfaction by category"
                  nameHeader="Category"
                  rows={c.byCategory}
                />
              </div>
            </div>
          </div>
        )}
      </ReportSection>

      <ReportSection
        id="faq"
        title="Self-service (FAQ deflection)"
        subtitle="Customer searches in the Help Center and on the new-ticket form"
        query={deflection}
      >
        {(d) => (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <StatTile label="Searches" value={d.totals.searches} />
              <StatTile
                label="Found nothing"
                value={d.totals.zeroResults}
                hint={
                  d.totals.searches
                    ? fmtPct(Math.round((d.totals.zeroResults / d.totals.searches) * 1000) / 10)
                    : undefined
                }
              />
              <StatTile label="Opened an article" value={d.totals.clicked} />
              <StatTile
                label="Deflected"
                value={d.totals.deflected}
                hint="read an article, no ticket"
              />
              <StatTile
                label="Deflection rate"
                value={fmtPct(d.totals.deflectionRate)}
                hint="of all searches"
              />
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium">Searches that found nothing</h3>
              <p className="mb-2 text-xs text-slate-500">
                Article ideas: customers looked for these and came up empty.
              </p>
              {d.zeroResults.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 py-5 text-center text-sm text-slate-500">
                  No zero-result searches in this period.
                </p>
              ) : (
                <TableWrap label="Zero-result searches">
                  <thead>
                    <tr>
                      <Th>Search</Th>
                      <Th>Times</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.zeroResults.slice(0, 10).map((r) => (
                      <tr key={r.query}>
                        <Td className="font-medium">{r.query}</Td>
                        <Td>{r.count}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </div>
          </div>
        )}
      </ReportSection>
    </div>
  );
}
