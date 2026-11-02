@echo off
REM Prerequisites: Java 21 JDK, Maven Wrapper files, and a reachable PostgreSQL database.
REM Optional environment: TASKFLOW_DB_URL, TASKFLOW_DB_USERNAME, TASKFLOW_DB_PASSWORD.
REM Defaults target the local Compose database; set secrets in the process environment only.

cd /d "%~dp0"
if errorlevel 1 (
    echo ERROR: Could not change to the backend service directory.
    exit /b 1
)

if defined JAVA_HOME (
    if not exist "%JAVA_HOME%\bin\java.exe" (
        echo ERROR: JAVA_HOME does not contain bin\java.exe. Install Java 21 and correct JAVA_HOME.
        exit /b 1
    )
    set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"
) else (
    where java >nul 2>nul
    if errorlevel 1 (
        echo ERROR: Java 21 is required but java.exe was not found on PATH.
        exit /b 1
    )
    set "JAVA_EXE=java.exe"
)

"%JAVA_EXE%" -version 2>&1 | findstr /C:"21." >nul
if errorlevel 1 (
    echo ERROR: Java 21 is required. Install a Java 21 JDK or set JAVA_HOME to one.
    exit /b 1
)

if not exist "mvnw.cmd" (
    echo ERROR: Maven Wrapper mvnw.cmd is missing from the backend service directory.
    exit /b 1
)

if not exist ".mvn\wrapper\maven-wrapper.jar" (
    echo ERROR: Maven Wrapper bootstrap JAR is missing: .mvn\wrapper\maven-wrapper.jar
    exit /b 1
)

if not exist ".mvn\wrapper\maven-wrapper.properties" (
    echo ERROR: Maven Wrapper configuration is missing: .mvn\wrapper\maven-wrapper.properties
    exit /b 1
)

call mvnw.cmd spring-boot:run %*
set "MAVEN_EXIT_CODE=%ERRORLEVEL%"
exit /b %MAVEN_EXIT_CODE%
