ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'user',
  'admin',
  'superadmin',
  'manager',
  'sales_manager',
  'property_consultant',
  'financial_manager',
  'financial_admin',
  'crm_admin',
  'contract_manager',
  'contract_person',
  'chairman',
  'vice_chairman',
  'ceo'
));
