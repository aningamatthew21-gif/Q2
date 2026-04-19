import React from 'react';

const Icon = ({ id, className }) => <i className={`fas fa-${id} ${className || ''}`}></i>;

export default Icon;
