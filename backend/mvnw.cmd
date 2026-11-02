@echo off
setlocal
set "MAVEN_PROJECTBASEDIR=%~dp0"
set "JAVA_EXE=java.exe"

if defined JAVA_HOME (
    if not exist "%JAVA_HOME%\bin\java.exe" (
        echo ERROR: JAVA_HOME does not point to a Java 21 installation.
        exit /b 1
    )
    set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"
) else (
    where java >nul 2>nul
    if errorlevel 1 (
        echo ERROR: Java 21 is required. Set JAVA_HOME or add java.exe to PATH.
        exit /b 1
    )
)

if not exist "%MAVEN_PROJECTBASEDIR%.mvn\wrapper\maven-wrapper.jar" (
    echo ERROR: Maven Wrapper bootstrap JAR is missing: %MAVEN_PROJECTBASEDIR%.mvn\wrapper\maven-wrapper.jar
    exit /b 1
)

pushd "%MAVEN_PROJECTBASEDIR%"
"%JAVA_EXE%" %MAVEN_OPTS% "-Dmaven.multiModuleProjectDirectory=%MAVEN_PROJECTBASEDIR%." -classpath ".mvn\wrapper\maven-wrapper.jar" org.apache.maven.wrapper.MavenWrapperMain %*
set "MAVEN_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %MAVEN_EXIT_CODE%
