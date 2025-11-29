/**
 * Lightweight i18n utilities for the calculator UI.
 * - t(key, lang): returns translated string for supported keys.
 * - isRTL(lang): true for Arabic.
 * - applyDocumentDirection(lang): sets html[dir] and html[lang].
 * - getArabicMonth(month): localized Arabic month names.
 */

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

export function getArabicMonth(month) {
  if (month < 1 || month > 12) return '';
  return ARABIC_MONTHS[month - 1];
}

export function isRTL(lang) {
  return String(lang).toLowerCase() === 'ar';
}

export function applyDocumentDirection(lang) {
  const html = document.documentElement;
  html.setAttribute('lang', isRTL(lang) ? 'ar' : 'en');
  html.setAttribute('dir', isRTL(lang) ? 'rtl' : 'ltr');
}

const dict = {
  en: {
    inputs: 'Inputs',
    language_for_written_amounts: 'Language for Written Amounts',
    arabic: 'Arabic',
    english: 'English',
    currency: 'Currency (English only)',
    offer_date: 'Offer Date',
    first_payment_date: 'First Payment Date',
    mode: 'Mode',
    installment_frequency: 'Installment Frequency',
    monthly: 'monthly',
    quarterly: 'quarterly',
    bi_annually: 'bi-annually',
    annually: 'annually',
    std_total_price: 'List Price (Std Total)',
    unit_breakdown: 'Unit Breakdown',
    base: 'Base',
    garden: 'Garden',
    roof: 'Roof',
    storage: 'Storage',
    garage: 'Garage',
    maintenance: 'Maintenance',
    total_excl_maint: 'Total (excl. maintenance)',
    std_financial_rate: 'Std Financial Rate (%)',
    std_calculated_pv: 'Std Calculated PV',
    sales_discount: 'Sales Discount (%)',
    dp_type: 'DP Type',
    amount: 'amount',
    percentage: 'percentage',
    down_payment_value: 'Down Payment Value',
    plan_duration_years: 'Plan Duration (years)',
    handover_year: 'Handover Year',
    additional_handover_payment: 'Additional Handover Payment',
    split_first_year: 'Split First Year Payments?',
    client_information: 'Client Information',
    buyer_name: 'Buyer Name',
    primary_phone: 'Primary Phone No.',
    nationality: 'Nationality',
    id_or_passport: 'National ID / Passport No.',
    id_issue_date: 'ID/Passport Issue Date',
    birth_date: 'Birth Date',
    address: 'Address',
    secondary_phone: 'Secondary Phone No.',
    email: 'Email Address',
    scan_egypt_id: 'Scan Egyptian National ID',
    extract_from_id: 'Extract from ID',
    payment_schedule: 'Payment Schedule',
    acceptance_evaluation: 'Acceptance Evaluation',
    generate_pricing_form: 'Generate Pricing Form',
    generate_reservation_form: 'Generate Reservation Form',
    generate_contract: 'Generate Contract',
    export_xlsx: 'Export to Excel (.xlsx)',
    export_csv: 'Export to CSV',
    generate_checks_sheet: 'Generate Checks Sheet (.xlsx)',
    month: 'Month',
    date: 'Date',
    label: 'Label',
    amount_label: 'Amount',
    written_amount: 'Written Amount',
    total: 'Total',
    offer_date_short: 'Offer Date:',
    first_payment_date_short: 'First Payment Date:',
    no_schedule_yet: 'No schedule yet. Fill the form and click "Calculate (Generate Plan)".'
  },
  ar: {
    inputs: 'المدخلات',
    language_for_written_amounts: 'لغة المبالغ بالحروف',
    arabic: 'العربية',
    english: 'الإنجليزية',
    currency: 'العملة (بالإنجليزية فقط)',
    offer_date: 'تاريخ العرض',
    first_payment_date: 'تاريخ أول قسط',
    mode: 'الوضع',
    installment_frequency: 'تكرار الأقساط',
    monthly: 'شهري',
    quarterly: 'ربع سنوي',
    bi_annually: 'نصف سنوي',
    annually: 'سنوي',
    std_total_price: 'سعر القائمة (الإجمالي القياسي)',
    unit_breakdown: 'تفصيل سعر الوحدة',
    base: 'أساسي',
    garden: 'حديقة',
    roof: 'سطح',
    storage: 'مخزن',
    garage: 'جراج',
    maintenance: 'صيانة',
    total_excl_maint: 'الإجمالي (بدون الصيانة)',
    std_financial_rate: 'معدل التمويل القياسي (%)',
    std_calculated_pv: 'القيمة الحالية القياسية',
    sales_discount: 'خصم المبيعات (%)',
    dp_type: 'نوع الدفعة المقدمة',
    amount: 'مبلغ',
    percentage: 'نسبة',
    down_payment_value: 'قيمة الدفعة المقدمة',
    plan_duration_years: 'مدة الخطة (بالسنوات)',
    handover_year: 'سنة التسليم',
    additional_handover_payment: 'دفعة إضافية عند التسليم',
    split_first_year: 'تقسيم دفعات السنة الأولى؟',
    client_information: 'بيانات العميل',
    buyer_name: 'اسم المشتري',
    primary_phone: 'رقم الهاتف (الأساسي)',
    nationality: 'الجنسية',
    id_or_passport: 'الرقم القومي / رقم الجواز',
    id_issue_date: 'تاريخ الإصدار',
    birth_date: 'تاريخ الميلاد',
    address: 'العنوان',
    secondary_phone: 'رقم هاتف إضافي',
    email: 'البريد الإلكتروني',
    scan_egypt_id: 'مسح بطاقة الرقم القومي المصرية',
    extract_from_id: 'استخراج من البطاقة',
    payment_schedule: 'جدول السداد',
    acceptance_evaluation: 'تقييم القبول',
    generate_pricing_form: 'إنشاء نموذج التسعير',
    generate_reservation_form: 'إنشاء استمارة الحجز',
    generate_contract: 'إنشاء العقد',
    export_xlsx: 'تصدير إلى إكسل (.xlsx)',
    export_csv: 'تصدير إلى CSV',
    generate_checks_sheet: 'إنشاء بيان الشيكات (.xlsx)',
    month: 'الشهر',
    date: 'التاريخ',
    label: 'الوصف',
    amount_label: 'المبلغ',
    written_amount: 'المبلغ بالحروف',
    total: 'الإجمالي',
    offer_date_short: 'تاريخ العرض:',
    first_payment_date_short: 'تاريخ أول قسط:',
    no_schedule_yet: 'لا يوجد جدول بعد. يرجى ملء النموذج والضغط على \"احسب (توليد الخطة)\".'
  }
};

export function t(key, lang = 'en') {
  const l = isRTL(lang) ? 'ar' : 'en';
  return dict[l][key] ?? key;
}
