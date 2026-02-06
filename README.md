# SecurePass Vault - Gestor de Contraseñas Seguro

Una aplicación moderna y segura para gestionar contraseñas con encriptación AES-256-GCM, desbloqueo por gestos y generación de contraseñas seguras.

## 🚀 Características de Producción

- **Encriptación AES-256-GCM** con PBKDF2 para derivación de claves
- **Almacenamiento seguro** con auto-bloqueo por inactividad
- **Generador de contraseñas** con entropía criptográfica
- **Desbloqueo por gestos** con hash SHA-256
- **Exportación/Importación** de datos encriptados
- **Interfaz responsive** y moderna
- **Categorización** y búsqueda avanzada
- **Recordatorios** de contraseñas antiguas

## 📋 Requisitos

- Node.js 18+ 
- npm o yarn

## 🛠️ Instalación

1. **Clonar el repositorio:**
   ```bash
   git clone <repository-url>
   cd securepass-vault
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Configurar variables de entorno:**
   ```bash
   cp .env.example .env.local
   # Editar .env.local con tus configuraciones
   ```

4. **Ejecutar en desarrollo:**
   ```bash
   npm run dev
   ```

## 🏗️ Construcción para Producción

```bash
# Verificar tipos TypeScript
npm run type-check

# Ejecutar linting
npm run lint

# Construir para producción
npm run build

# Previsualizar build
npm run preview
```

## 🔒 Seguridad

### Encriptación
- **AES-256-GCM** para encriptación de datos
- **PBKDF2** con 100,000 iteraciones para derivación de claves
- **Salt aleatorio** de 32 bytes por sesión
- **IV aleatorio** de 16 bytes por encriptación

### Almacenamiento
- Datos encriptados en localStorage
- Auto-bloqueo configurable (30 min por defecto)
- Limpieza automática de memoria al bloquear

### Gestión de Contraseñas
- Generación con `crypto.getRandomValues()`
- Verificación de fortaleza
- Recordatorios de expiración

## 📱 Uso

1. **Primera vez:** Crear patrón de desbloqueo
2. **Agregar contraseñas:** Usar el botón "+" o generador
3. **Organizar:** Usar categorías y búsqueda
4. **Exportar:** Hacer backup de datos encriptados
5. **Bloquear:** Usar "Lock Vault" o esperar auto-bloqueo

## 🚨 Advertencias de Seguridad

- **Nunca** compartas tu patrón de desbloqueo
- **Siempre** haz backup de tus datos
- **Mantén** tu navegador actualizado
- **Usa** HTTPS en producción
- **Considera** usar un gestor de contraseñas dedicado para máxima seguridad

## 📄 Licencia

MIT License - ver LICENSE para detalles.

## 🤝 Contribuir

1. Fork el proyecto
2. Crear rama feature (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request
