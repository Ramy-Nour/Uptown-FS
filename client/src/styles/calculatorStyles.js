const styles = {
  page: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
    background: '#f7f6f3',
    minHeight: '100vh',
    color: '#222'
  },
  container: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '24px 20px 48px'
  },
  header: {
    background: '#fff',
    border: '1px solid #ead9bd',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    boxShadow: '0 2px 6px rgba(169, 126, 52, 0.08)'
  },
  h1: { margin: 0, fontSize: 22, fontWeight: 700, color: '#A97E34' },
  sub: { color: '#6b7280', marginTop: 6, fontSize: 13 },
  section: {
    background: '#fff',
    border: '1px solid #ead9bd',
    borderRadius: 12,
    padding: 20,
    marginTop: 16,
    boxShadow: '0 2px 6px rgba(169, 126, 52, 0.06)'
  },
  sectionTitle: { margin: '0 0 12px 0', fontSize: 18, fontWeight: 700, color: '#A97E34' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  blockFull: { gridColumn: '1 / span 2' },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#4b5563', marginBottom: 6 },
  input: (err) => ({
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${err ? '#e11d48' : '#ead9bd'}`,
    outline: 'none',
    width: '100%',
    fontSize: 14,
    background: '#fbfaf7'
  }),
  select: (err) => ({
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${err ? '#e11d48' : '#ead9bd'}`,
    outline: 'none',
    width: '100%',
    fontSize: 14,
    background: '#fbfaf7'
  }),
  textarea: (err) => ({
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${err ? '#e11d48' : '#ead9bd'}`,
    outline: 'none',
    width: '100%',
    fontSize: 14,
    background: '#fbfaf7',
    minHeight: 80,
    resize: 'vertical'
  }),
  metaText: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid #ead9bd',
    background: '#fff',
    color: '#111827',
    cursor: 'pointer'
  },
  btnPrimary: {
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid #A97E34',
    background: '#A97E34',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 600
  },
  tableWrap: {
    maxWidth: 1200,
    overflow: 'auto',
    border: '1px solid #ead9bd',
    borderRadius: 12
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: 12, borderBottom: '1px solid #ead9bd', fontSize: 13, color: '#5b4630', background: '#f6efe3' },
  td: { padding: 12, borderBottom: '1px solid #f2e8d6', fontSize: 14 },
  tFootCell: { padding: 12, fontWeight: 700, background: '#fbfaf7' },
  error: { color: '#e11d48' },
  arInline: { fontWeight: 600, color: '#5b4630' }
}

export default styles