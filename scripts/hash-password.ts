import { hashPassword } from "../lib/auth";

// Usage: npm run hash-password -- <name> <password>
// Prints the APP_USERS entry for that person.
const [name, password] = process.argv.slice(2);
if (!name || !password) {
  console.error("Usage: npm run hash-password -- <name> <password>");
  process.exit(1);
}
console.log(`${name}:${hashPassword(password)}`);
