import {
  BarChart,
  ChartDataTable,
  ChartExplainer,
  LineChart,
  RankedBarChart,
  Sparkline,
  StackedColumnChart,
  type ChartDatum,
  type ChartSeries,
} from '@makinbakin/sdk/charts'

const data: ChartDatum[] = [{ x: 'one', values: { completed: 1 } }]
const series: ChartSeries[] = [{ key: 'completed', label: 'Completed' }]

export const validChartFoundation = (
  <>
    <ChartDataTable caption="Outcomes" data={data} series={series} defaultOpen />
    <Sparkline label="Outcome trend" values={[1, null, 3]} labels={['One', 'Two', 'Three']} />
    <LineChart label="Outcome trend" data={data} series={series} />
    <BarChart label="Outcome comparison" data={data} series={series} stacked />
    <RankedBarChart label="Outcome ranking" data={data} series={series[0]!} />
    <StackedColumnChart label="Outcome composition" data={data} series={series} />
    <ChartExplainer>Exact values remain available.</ChartExplainer>
  </>
)

// @ts-expect-error exact data requires a stable x key
export const invalidDatum: ChartDatum = { values: { completed: 1 } }
// @ts-expect-error a sparkline always needs an accessible description
export const invalidSparkline = <Sparkline values={[1, 2]} />
// @ts-expect-error series values must be numeric or explicitly missing
export const invalidSparklineValue = <Sparkline label="Invalid" values={[1, 'missing']} />
