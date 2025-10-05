# Employee Performance Analytics (EPA)

A desktop application for importing, analyzing, and managing employee performance data. Built with Tauri, Rust, React, and TypeScript.

## Features

### Phase 1 (Implemented)
- ✅ **Project Setup**
  - Tauri desktop app with React + TypeScript frontend
  - Tailwind CSS for styling
  - SQLite database with SQLx for data persistence
  - Windows-optimized build configuration

- ✅ **CSV Import & Processing**
  - Auto-detect file encoding (UTF-8, Windows-1252)
  - Auto-detect delimiter (comma, tab, semicolon)
  - Support for Indonesian text and special characters
  - Preview imported data before processing
  - Handle quoted fields and bracketed employee names

- ✅ **Database Architecture**
  - Datasets management with versioning
  - Employee records with metadata
  - Competency tracking
  - Performance scores with text-to-numeric mapping
  - Validation issues tracking
  - Performance summaries

- ✅ **Basic UI Components**
  - File import with drag-and-drop
  - CSV preview with statistics
  - Responsive layout with Tailwind CSS

### Phase 2 (Planned)
- ⏳ Data validation and mapping engine
- ⏳ Employee conflict resolution
- ⏳ Dashboard with analytics and charts
- ⏳ Employee detail view with performance radar
- ⏳ Dataset versioning and comparison
- ⏳ Export to Excel, PDF, CSV
- ⏳ Windows-native integrations

## Tech Stack

### Backend (Rust)
- **tauri** - Desktop app framework
- **tokio** - Async runtime
- **sqlx** - SQLite database with compile-time query verification
- **csv** - CSV parsing
- **encoding_rs** - Character encoding detection
- **chrono** - Date/time handling
- **serde** - Serialization/deserialization
- **thiserror** - Error handling

### Frontend (React + TypeScript)
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Vite** - Build tool
- **lucide-react** - Icons
- **react-dropzone** - File upload
- **@tauri-apps/plugin-dialog** - Native file dialogs

## Getting Started

### Prerequisites
- **Rust** (1.70+): Install from [rustup.rs](https://rustup.rs/)
- **Node.js** (18+): Install from [nodejs.org](https://nodejs.org/)
- **pnpm**: Install with `npm install -g pnpm`

### Development Setup

1. **Clone the repository**
   ```bash
   cd new-epa
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Run in development mode**
   ```bash
   pnpm tauri dev
   ```

   This will:
   - Build the Rust backend
   - Start the Vite dev server
   - Launch the Tauri desktop app

### Building for Production

#### Windows
```bash
pnpm tauri build
```

This creates:
- `src-tauri/target/release/employee-monitoring.exe` - Portable executable
- `src-tauri/target/release/bundle/msi/` - Windows installer (.msi)

#### macOS
```bash
pnpm tauri build
```

This creates:
- `.app` bundle in `src-tauri/target/release/bundle/macos/`
- `.dmg` installer in `src-tauri/target/release/bundle/dmg/`

## Project Structure

```
new-epa/
├── src/                      # React frontend
│   ├── components/          # UI components
│   │   └── FileImport.tsx   # File upload component
│   ├── lib/                 # Utilities
│   │   ├── api.ts          # Tauri command bindings
│   │   └── utils.ts        # Helper functions
│   ├── types/              # TypeScript types
│   │   └── models.ts       # Data models
│   ├── App.tsx             # Main app component
│   ├── main.tsx            # Entry point
│   └── index.css           # Global styles
│
├── src-tauri/               # Rust backend
│   ├── src/
│   │   ├── commands/       # Tauri commands
│   │   │   ├── csv.rs     # CSV import commands
│   │   │   └── dataset.rs  # Dataset commands
│   │   ├── csv_parser/     # CSV parsing logic
│   │   │   └── mod.rs
│   │   ├── db/             # Database layer
│   │   │   ├── models.rs   # Data models
│   │   │   └── mod.rs      # Database connection
│   │   └── lib.rs          # Main Rust entry
│   ├── migrations/         # SQL migrations
│   │   └── 001_init.sql   # Initial schema
│   └── Cargo.toml          # Rust dependencies
│
├── docs/                    # Documentation & samples
│   ├── 00-Product-Plan.md
│   ├── data_pegawai_all.csv
│   └── contoh_data_penilaian.csv
│
└── package.json            # Frontend dependencies
```

## Database Schema

### Tables
- **datasets** - Imported data versions
- **employees** - Employee master data
- **competencies** - Competency catalog
- **scores** - Performance scores
- **rating_mappings** - Text-to-numeric mappings (e.g., "Baik" → 3)
- **summaries** - Generated performance summaries
- **validation_issues** - Import validation warnings

## Usage

### Importing Employee Data

1. Click **Import CSV File** or drag & drop a file
2. Review the preview showing:
   - Detected encoding
   - Delimiter type
   - Number of employees
   - Sample data rows
3. Click **Continue Import** to process

### Supported CSV Formats

#### Employee Master Data
```csv
No.,NAMA,NIP,Gol,JABATAN,SUB JABATAN
1,JOHN DOE,123456,III/a,Manager,Staff
```

#### Performance Scores
```csv
"1. Inisiatif [JOHN DOE]","2. Teamwork [JOHN DOE]"
Baik,Sangat Baik
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Run development server
pnpm tauri dev

# Build for production
pnpm tauri build

# Run frontend only (for UI development)
pnpm dev

# Type check
pnpm tsc

# Lint
pnpm lint
```

## Troubleshooting

### Database Migration Issues
If you encounter migration errors, delete the database:
```bash
# macOS/Linux
rm ~/Library/Application\ Support/com.fabhiantomaoludyo.employee-monitoring/epa.db

# Windows
del %APPDATA%\com.fabhiantomaoludyo.employee-monitoring\epa.db
```

### Build Errors
1. Ensure Rust is up to date: `rustup update`
2. Clear build cache: `cargo clean`
3. Reinstall dependencies: `pnpm install`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

Private project - All rights reserved

## Roadmap

See [Product Plan](docs/00-Product-Plan.md) for detailed feature roadmap.
