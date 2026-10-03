# Souq Luxury Store

نسخة احترافية من المتجر مع Owner Panel + PostgreSQL + JWT authentication.

## التشغيل

1. ثبّت Node.js 20+ وPostgreSQL.
2. انسخ `.env.example` إلى `.env`.
3. ضع `DATABASE_URL` و`JWT_SECRET` و`OWNER_PASSWORD`.
4. شغّل `npm install` ثم `npm start`.
5. افتح `http://localhost:3000`.

يمكن أيضًا تنفيذ `schema.sql` يدويًا؛ السيرفر ينشئ الجداول تلقائيًا عند التشغيل ويضيف المنتجات/الأكواد الافتراضية إذا كانت قاعدة البيانات فارغة.

## API

- `GET /api/store` المنتجات والأكواد العامة.
- `POST /api/orders` إنشاء طلب.
- `POST /api/auth/login` تسجيل دخول المالك.
- `PUT /api/store` تحديث المنتجات والأكواد — للمالك فقط.
- `GET /api/admin/orders` عرض الطلبات — للمالك فقط.
- `GET /health` فحص حالة السيرفر وقاعدة البيانات.

## الأمان

لا تضع `.env` داخل GitHub. غيّر `OWNER_PASSWORD` و`JWT_SECRET` قبل النشر، واستخدم PostgreSQL مستضافًا مع HTTPS في الإنتاج.
