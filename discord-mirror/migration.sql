CREATE SEQUENCE auto_increment START 1;

CREATE TABLE DAILYCLACKMESSAGE (
    ID integer primary key default nextval('auto_increment'),
    USERID varchar(255),
    MESSAGE TEXT,
    datetime DATETIME
);
