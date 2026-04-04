// [REUSE] Supabase 서버사이드 클라이언트
// Expo 전환 시: 그대로 재활용 가능
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
)

module.exports = supabase
