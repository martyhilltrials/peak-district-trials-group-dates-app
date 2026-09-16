'use strict';

module.exports = function handler(request, response) {
  var url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  var key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');

  if (!url || !key) {
    response.status(500).json({
      error: 'Supabase public environment variables are missing.'
    });
    return;
  }

  response.status(200).json({url: url, key: key});
};
