export function buildDocumentBody(documentType, { language, currency, clientInfo, unitInfo, stdPlan, genResult, inputs }) {
  // Build buyers[] from clientInfo (supports up to 4 buyers via suffixed keys: _2, _3, _4)
  const numBuyersRaw = Number(clientInfo?.number_of_buyers)
  const numBuyers = Math.min(Math.max(numBuyersRaw || 1, 1), 4)
  const buyers = []
  for (let i = 1; i <= numBuyers; i++) {
    const sfx = i === 1 ? '' : `_${i}`
    buyers.push({
      buyer_name: clientInfo?.[`buyer_name${sfx}`] || '',
      nationality: clientInfo?.[`nationality${sfx}`] || '',
      id_or_passport: clientInfo?.[`id_or_passport${sfx}`] || '',
      id_issue_date: clientInfo?.[`id_issue_date${sfx}`] || '',
      birth_date: clientInfo?.[`birth_date${sfx}`] || '',
      address: clientInfo?.[`address${sfx}`] || '',
      phone_primary: clientInfo?.[`phone_primary${sfx}`] || '',
      phone_secondary: clientInfo?.[`phone_secondary${sfx}`] || '',
      email: clientInfo?.[`email${sfx}`] || ''
    })
  }

  const docData = {
    buyer_name: clientInfo?.buyer_name || '',
    nationality: clientInfo?.nationality || '',
    id_or_passport: clientInfo?.id_or_passport || '',
    id_issue_date: clientInfo?.id_issue_date || '',
    birth_date: clientInfo?.birth_date || '',
    address: clientInfo?.address || '',
    phone_primary: clientInfo?.phone_primary || '',
    phone_secondary: clientInfo?.phone_secondary || '',
    email: clientInfo?.email || '',
    offer_date: inputs?.offerDate || new Date().toISOString().slice(0, 10),
    first_payment_date: inputs?.firstPaymentDate || inputs?.offerDate || new Date().toISOString().slice(0, 10),
    'اسم المشترى': clientInfo?.buyer_name || '',
    'الجنسية': clientInfo?.nationality || '',
    'رقم قومي/ رقم جواز': clientInfo?.id_or_passport || '',
    'تاريخ الاصدار': clientInfo?.id_issue_date || '',
    'تاريخ الميلاد': clientInfo?.birth_date || '',
    'العنوان': clientInfo?.address || '',
    'رقم الهاتف': clientInfo?.phone_primary || '',
    'رقم الهاتف (2)': clientInfo?.phone_secondary || '',
    'البريد الالكتروني': clientInfo?.email || '',
    unit_type: unitInfo?.unit_type || '',
    unit_code: unitInfo?.unit_code || '',
    unit_number: unitInfo?.unit_number || '',
    floor: unitInfo?.floor || '',
    building_number: unitInfo?.building_number || '',
    block_sector: unitInfo?.block_sector || '',
    zone: unitInfo?.zone || '',
    garden_details: unitInfo?.garden_details || '',
    'نوع الوحدة': unitInfo?.unit_type || '',
    'كود الوحدة': unitInfo?.unit_code || '',
    'وحدة رقم': unitInfo?.unit_number || '',
    'الدور': unitInfo?.floor || '',
    'مبنى رقم': unitInfo?.building_number || '',
    'قطاع': unitInfo?.block_sector || '',
    'مجاورة': unitInfo?.zone || '',
    'مساحة الحديقة': unitInfo?.garden_details || '',
    std_total_price: Number(stdPlan?.totalPrice) || 0,
    std_financial_rate_percent: Number(stdPlan?.financialDiscountRate) || 0,
    std_calculated_pv: Number(stdPlan?.calculatedPV) || 0,
    buyers
  }

  // Caller will merge this docData into the final request body
  return {
    buyers,
    data: docData
  }
}