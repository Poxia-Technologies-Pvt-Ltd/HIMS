import jwt from 'jsonwebtoken';

// Verifies the patient-portal JWT and that its owner matches the :phone in the path.
export const authenticatePatientPortal = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.type !== 'patient') {
      return res.status(403).json({ message: 'Access denied. Invalid token type.' });
    }
    if (decoded.phone !== req.params.phone) {
      return res.status(403).json({ message: 'Access denied.' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};
