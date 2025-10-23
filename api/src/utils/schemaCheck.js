import { pool } from '../db.js'

export async function getMissingColumns(table, columns) {
  try {
    const q = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = $1
    `
    const r = await pool.query(q, [table])
    const present = new Set(r.rows.map(row => row.column_name))
    return columns.filter(c => !present.has(c))
  } catch (e) {
    return columns
  }
}

export async function runSchemaCheck() {
  const required = {
    units: [
      'id','code','unit_type','unit_type_id','base_price','currency','model_id','area','orientation',
      'has_garden','garden_area','has_roof','roof_area','maintenance_price','garage_price','garden_price',
      'roof_price','storage_price','available','unit_status'
    ],
    unit_types: ['id','name'],
    unit_models: [
      'id','model_name','model_code','area','orientation','has_garden','garden_area','has_roof','roof_area',
      'garage_area','garage_standard_code'
    ]
  }
  const missing = {}
  for (const [table, cols] of Object.entries(required)) {
    const miss = await getMissingColumns(table, cols)
    if (miss.length) missing[table] = miss
  }
  return missing
}