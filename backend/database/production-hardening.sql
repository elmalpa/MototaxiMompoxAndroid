-- Run after schema.sql or schema.azure.sql, in the application database.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.Users', 'session_version') IS NULL
  ALTER TABLE dbo.Users ADD session_version INT NOT NULL CONSTRAINT DF_Users_session_version DEFAULT 0;
IF COL_LENGTH('dbo.Users', 'phone_verified') IS NULL
  ALTER TABLE dbo.Users ADD phone_verified BIT NOT NULL CONSTRAINT DF_Users_phone_verified DEFAULT 0;
IF COL_LENGTH('dbo.DriverProfiles', 'approval_status') IS NULL
  ALTER TABLE dbo.DriverProfiles ADD approval_status VARCHAR(12) NOT NULL CONSTRAINT DF_DriverProfiles_approval DEFAULT 'pending';
IF OBJECT_ID('dbo.AuthChallenges', 'U') IS NULL
  CREATE TABLE dbo.AuthChallenges (
    id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES dbo.Users(id) ON DELETE CASCADE,
    purpose VARCHAR(12) NOT NULL CHECK (purpose IN ('verify','reset')),
    code_hash VARCHAR(64) NOT NULL,
    expires_at DATETIME2 NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    consumed BIT NOT NULL DEFAULT 0
  );
IF OBJECT_ID('dbo.SupportReports', 'U') IS NULL
  CREATE TABLE dbo.SupportReports (
    id INT IDENTITY PRIMARY KEY,
    user_id INT NULL REFERENCES dbo.Users(id) ON DELETE SET NULL,
    ride_id INT NULL REFERENCES dbo.RideRequests(id) ON DELETE SET NULL,
    message NVARCHAR(2000) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
IF OBJECT_ID('dbo.DriverLocations', 'U') IS NULL
  CREATE TABLE dbo.DriverLocations (
    user_id INT NOT NULL PRIMARY KEY REFERENCES dbo.Users(id) ON DELETE CASCADE,
    latitude DECIMAL(9,6) NOT NULL,
    longitude DECIMAL(9,6) NOT NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
IF OBJECT_ID('dbo.PushReceipts', 'U') IS NULL
  CREATE TABLE dbo.PushReceipts (
    id VARCHAR(100) NOT NULL PRIMARY KEY,
    token NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
COMMIT;
