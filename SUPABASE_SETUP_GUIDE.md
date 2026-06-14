# Supabase Setup Guide for LegalMind Yemen

## ✅ Configuration Complete

Your application has been configured with the following Supabase credentials:
- **Project URL**: https://dlkxzjyvcmsgnovwmntd.supabase.co
- **Anon Key**: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsa3h6anl2Y21zZ25vdndtbnRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjA1MjcsImV4cCI6MjA5NjQ5NjUyN30.yszpvAQLGhDEZeHeNNg5n6_AAcuLyzq1RnQXQwwfUjU

## 📋 Database Schema Application

The complete database schema is located at:
```
supabase/migrations/001_production_schema.sql
```

### Method 1: Using Supabase SQL Editor (Recommended)

1. Go to your Supabase project: https://supabase.com/dashboard/project/dlkxzjyvcmsgnovwmntd
2. Navigate to **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the entire contents of `supabase/migrations/001_production_schema.sql`
5. Paste it into the SQL Editor
6. Click **Run** to execute the schema

### Method 2: Using Supabase CLI

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref dlkxzjyvcmsgnovwmntd

# Push the migration
supabase db push
```

## 🗄️ Database Tables

The schema includes the following tables:

### Core Tables
- **firms** - Multi-tenant firm management
- **employees** - Employee profiles linked to auth users
- **lawyers** - Lawyer specializations and stats
- **clients** - Client information
- **cases** - Legal cases with full details
- **sessions** - Court sessions
- **documents** - Document storage
- **notifications** - User notifications

### System Tables
- **audit_logs** - Audit trail for all operations
- **error_logs** - Error logging for debugging

## 🔐 Row Level Security (RLS)

The schema includes comprehensive RLS policies:

- **Firms**: Users can only access their own firm
- **Employees**: Users can only see employees from their firm
- **Clients**: Firm-level access with role-based permissions
- **Cases**: Firm-level access with role-based permissions
- **Sessions**: Access via case ownership
- **Documents**: Access via case ownership
- **Notifications**: Firm-level with employee-specific filtering

## 🧪 Testing the Connection

The application includes an automatic connection test that runs in development mode. Check the browser console for:

```
[TEST] Starting Supabase connection test...
[TEST] Checking Supabase configuration...
[TEST] Supabase configured: true
[TEST] Testing database connection...
[TEST] ✅ Database connection successful
[TEST] Testing authentication...
[TEST] Current session: None
[TEST] ✅ Authentication service is working
[TEST] Checking required tables...
[TEST] ✅ Table 'firms' exists and is accessible
[TEST] ✅ Table 'employees' exists and is accessible
...
```

## 🔑 Authentication Features

The application supports:

- **Sign Up** - Email/password registration with auto-profile creation
- **Sign In** - Email/password authentication
- **Sign Out** - Secure session termination
- **Session Persistence** - Automatic session restoration
- **Password Reset** - Email-based password recovery
- **Email Verification** - Optional email confirmation
- **MFA/2FA** - Multi-factor authentication support

## 📝 Manual Testing Steps

### 1. Test Registration
1. Open the application at http://localhost:5174
2. Click on "سجل مكتبك الآن" (Register your firm)
3. Fill in the registration form:
   - Name: Test Lawyer
   - Company: Test Firm
   - Email: test@example.com
   - Password: Test1234
4. Submit the form
5. Check console for `[AUTH]` logs

### 2. Test Login
1. Navigate to the login page
2. Enter the credentials you just created
3. Check console for authentication logs
4. Verify redirect to dashboard

### 3. Test Database Operations
1. After login, try creating a client
2. Try creating a case
3. Check browser console and Supabase dashboard for data

## 🚨 Troubleshooting

### Connection Issues
- Verify `.env.local` contains correct credentials
- Check browser console for error messages
- Ensure Supabase project is active

### RLS Issues
- Run the schema SQL to create RLS policies
- Check Supabase Dashboard > Authentication > Policies
- Ensure user is authenticated before querying

### Missing Tables
- Run the schema SQL in Supabase SQL Editor
- Check Supabase Dashboard > Database > Tables
- Verify all tables are created

## 📊 Verification Checklist

- [ ] `.env.local` contains Supabase URL and Anon Key
- [ ] Database schema applied to Supabase project
- [ ] All tables created in Supabase Dashboard
- [ ] RLS policies enabled and working
- [ ] Connection test passes in browser console
- [ ] Registration works
- [ ] Login works
- [ ] Dashboard loads after login
- [ ] Can create clients
- [ ] Can create cases
- [ ] No TypeScript errors
- [ ] No runtime errors

## 🎯 Next Steps

1. Apply the database schema to your Supabase project
2. Restart the development server
3. Check browser console for connection test results
4. Test registration and login
5. Verify all features work correctly

## 📞 Support

If you encounter issues:
1. Check browser console for detailed error logs
2. Check Supabase Dashboard logs
3. Verify all environment variables are set
4. Ensure database schema is applied correctly
