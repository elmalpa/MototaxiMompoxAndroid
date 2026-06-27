IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Users (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
    name NVARCHAR(120) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    password_hash NVARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CONSTRAINT DF_Users_role DEFAULT 'cliente',
    fcm_token NVARCHAR(MAX) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_Users_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Users_phone UNIQUE (phone),
    CONSTRAINT CK_Users_role CHECK (role IN ('cliente', 'conductor', 'admin'))
  );
END;
GO

IF EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE name = 'CK_Users_role'
    AND parent_object_id = OBJECT_ID(N'dbo.Users')
)
BEGIN
  ALTER TABLE dbo.Users DROP CONSTRAINT CK_Users_role;
END;
GO

ALTER TABLE dbo.Users
ADD CONSTRAINT CK_Users_role CHECK (role IN ('cliente', 'conductor', 'admin'));
GO

IF COL_LENGTH('dbo.Users', 'fcm_token') IS NULL
  ALTER TABLE dbo.Users ADD fcm_token NVARCHAR(MAX) NULL;
GO

IF OBJECT_ID(N'dbo.DriverProfiles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.DriverProfiles (
    user_id INT NOT NULL CONSTRAINT PK_DriverProfiles PRIMARY KEY,
    vehicle_plate VARCHAR(20) NOT NULL,
    is_available BIT NOT NULL CONSTRAINT DF_DriverProfiles_is_available DEFAULT 1,
    rating DECIMAL(3,2) NOT NULL CONSTRAINT DF_DriverProfiles_rating DEFAULT 5.00,
    CONSTRAINT FK_DriverProfiles_Users FOREIGN KEY (user_id) REFERENCES dbo.Users(id),
    CONSTRAINT CK_DriverProfiles_rating CHECK (rating >= 0 AND rating <= 5)
  );
END;
GO

IF OBJECT_ID(N'dbo.RideRequests', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.RideRequests (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RideRequests PRIMARY KEY,
    client_id INT NOT NULL,
    driver_id INT NULL,
    pickup_address NVARCHAR(255) NOT NULL,
    pickup_lat DECIMAL(9,6) NULL,
    pickup_lng DECIMAL(9,6) NULL,
    destination_address NVARCHAR(255) NOT NULL,
    destination_lat DECIMAL(9,6) NULL,
    destination_lng DECIMAL(9,6) NULL,
    estimated_price DECIMAL(10,2) NOT NULL,
    driver_offer_price DECIMAL(10,2) NULL,
    status VARCHAR(20) NOT NULL CONSTRAINT DF_RideRequests_status DEFAULT 'solicitado',
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_RideRequests_created_at DEFAULT SYSUTCDATETIME(),
    accepted_at DATETIME2(0) NULL,
    client_accepted_at DATETIME2(0) NULL,
    finished_at DATETIME2(0) NULL,
    driver_service_rating VARCHAR(10) NULL,
    driver_service_comment NVARCHAR(500) NULL,
    driver_service_rated_at DATETIME2(0) NULL,
    CONSTRAINT FK_RideRequests_Client FOREIGN KEY (client_id) REFERENCES dbo.Users(id),
    CONSTRAINT FK_RideRequests_Driver FOREIGN KEY (driver_id) REFERENCES dbo.Users(id),
    CONSTRAINT CK_RideRequests_status CHECK (status IN ('solicitado', 'ofertado', 'aceptado', 'en_camino', 'finalizado', 'cancelado')),
    CONSTRAINT CK_RideRequests_driver_service_rating CHECK (driver_service_rating IS NULL OR driver_service_rating IN ('bueno', 'regular', 'malo'))
  );
END;
GO

IF OBJECT_ID(N'dbo.RideRejectedDrivers', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.RideRejectedDrivers (
    ride_id INT NOT NULL,
    driver_id INT NOT NULL,
    rejected_at DATETIME2(0) NOT NULL CONSTRAINT DF_RideRejectedDrivers_rejected_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_RideRejectedDrivers PRIMARY KEY (ride_id, driver_id),
    CONSTRAINT FK_RideRejectedDrivers_RideRequests FOREIGN KEY (ride_id) REFERENCES dbo.RideRequests(id),
    CONSTRAINT FK_RideRejectedDrivers_Users FOREIGN KEY (driver_id) REFERENCES dbo.Users(id)
  );
END;
GO

IF COL_LENGTH('dbo.RideRequests', 'driver_offer_price') IS NULL
  ALTER TABLE dbo.RideRequests ADD driver_offer_price DECIMAL(10,2) NULL;
GO

IF COL_LENGTH('dbo.RideRequests', 'client_accepted_at') IS NULL
  ALTER TABLE dbo.RideRequests ADD client_accepted_at DATETIME2(0) NULL;
GO

IF COL_LENGTH('dbo.RideRequests', 'driver_service_rating') IS NULL
  ALTER TABLE dbo.RideRequests ADD driver_service_rating VARCHAR(10) NULL;
GO

IF COL_LENGTH('dbo.RideRequests', 'driver_service_comment') IS NULL
  ALTER TABLE dbo.RideRequests ADD driver_service_comment NVARCHAR(500) NULL;
GO

IF COL_LENGTH('dbo.RideRequests', 'driver_service_rated_at') IS NULL
  ALTER TABLE dbo.RideRequests ADD driver_service_rated_at DATETIME2(0) NULL;
GO

ALTER TABLE dbo.RideRequests ALTER COLUMN pickup_lat DECIMAL(9,6) NULL;
GO

ALTER TABLE dbo.RideRequests ALTER COLUMN pickup_lng DECIMAL(9,6) NULL;
GO

IF EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE name = 'CK_RideRequests_status'
    AND parent_object_id = OBJECT_ID(N'dbo.RideRequests')
)
BEGIN
  ALTER TABLE dbo.RideRequests DROP CONSTRAINT CK_RideRequests_status;
END;
GO

ALTER TABLE dbo.RideRequests
ADD CONSTRAINT CK_RideRequests_status CHECK (status IN ('solicitado', 'ofertado', 'aceptado', 'en_camino', 'finalizado', 'cancelado'));
GO

IF EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE name = 'CK_RideRequests_driver_service_rating'
    AND parent_object_id = OBJECT_ID(N'dbo.RideRequests')
)
BEGIN
  ALTER TABLE dbo.RideRequests DROP CONSTRAINT CK_RideRequests_driver_service_rating;
END;
GO

ALTER TABLE dbo.RideRequests
ADD CONSTRAINT CK_RideRequests_driver_service_rating CHECK (driver_service_rating IS NULL OR driver_service_rating IN ('bueno', 'regular', 'malo'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RideRequests_status_created_at' AND object_id = OBJECT_ID(N'dbo.RideRequests'))
  CREATE INDEX IX_RideRequests_status_created_at ON dbo.RideRequests(status, created_at DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RideRequests_client_id' AND object_id = OBJECT_ID(N'dbo.RideRequests'))
  CREATE INDEX IX_RideRequests_client_id ON dbo.RideRequests(client_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RideRequests_driver_id' AND object_id = OBJECT_ID(N'dbo.RideRequests'))
  CREATE INDEX IX_RideRequests_driver_id ON dbo.RideRequests(driver_id);
GO
